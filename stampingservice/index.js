'use strict';

let EventEmitter = require('events').EventEmitter,
    async = require('async'),
    bitcore = require('bitcore-lib'),
    fs = require('fs'),
    leveldown = require('leveldown'),
    levelup = require('levelup'),
    mkdirp = require('mkdirp'),
    util = require('util');

let $ = bitcore.util.preconditions,
    Block = bitcore.Block,
    BufferUtil = bitcore.util.buffer,
    Networks = bitcore.Networks;

const PREFIX_TIP = new Buffer('04', 'hex'),
      PREFIX = String.fromCharCode(0xff);

class StampingService extends EventEmitter {
    constructor(options) {
        if (!options) {
            options = {};
        }

        super();

        this.node = options.node;
        this.name = options.name;
        this.tip = null;
        this.genesis = null;
        this.retryInterval = 60000;
        this.log = this.node.log;

        $.checkState(this.node.network, 'Node is expected to have a "network" property');
        this.network = this.node.network;

        this.setDataPath();

        this.levelupStore = leveldown;
        if (options.store) {
            this.levelupStore = options.store;
        }
    }

    // setDataPath sets `this.dataPath` based on `this.node.network`.
    setDataPath() {
        $.checkState(this.node.services.bitcoind.spawn.datadir, 'bitcoind is expected to have a "spawn.datadir" property');
        let datadir = this.node.services.bitcoind.spawn.datadir;
        if (this.node.network !== Networks.testnet) {
            throw new Error('Unknown network: ' + this.network);
        }
        this.dataPath = datadir + '/testnet3/bitcore-stamps.db';
    }

    loadTip(callback) {
        let options = {
                keyEncoding: 'binary',
                valueEncoding: 'binary'
            },
            self = this;

        self.store.get(PREFIX_TIP, options, function(err, tipData) {
            if (err && err instanceof levelup.errors.NotFoundError) {
                self.tip = self.genesis;
                self.tip.__height = 0;
                self.connectBlock(self.genesis, function(err) {
                    if (err) {
                        return callback(err);
                    }

                    self.emit('addblock', self.genesis);
                    callback();
                });
                return;
            } else if (err) {
                return callback(err);
            }

            let hash = tipData.toString('hex'),
                times = 0;

            async.retry({
                times: 3,
                interval: self.retryInterval
            }, function(done) {
                self.node.getBlock(hash, function(err, tip) {
                    if (err) {
                        times++;
                        self.log.warn('Bitcoind does not have our tip (' + hash + '). Bitcoind may have crashed and needs to catch up.');
                        if (times < 3) {
                            self.log.warn(`Retrying in ${self.retryInterval / 1000} seconds.`);
                        }
                        return done(err);
                    }

                    done(null, tip);
                });
            }, function(err, tip) {
                if (err) {
                    self.log.warn('Giving up after 3 tries. Please report this bug to https://github.com/bitpay/bitcore-node/issues');
                    self.log.warn('Please reindex your database.');
                    return callback(err);
                }

                self.tip = tip;
                self.node.getBlockHeader(self.tip.hash, function(err, blockHeader) {
                    if (err) {
                        return callback(err);
                    }
                    if (!blockHeader) {
                        return callback(new Error('Could not get height for tip.'));
                    }
                    self.tip.__height = blockHeader.height;
                    callback();
                });
            });
        });
    }

    // connectBlock connects a block to the database and add indexes
    connectBlock(block, callback) {
        this.log.info('adding block', block.hash);
        this.blockHandler(block, true, callback);
    }

    // disconnectBlock disconnects a block from the database and removes indexes
    disconnectBlock(block, callback) {
        this.log.info('disconnecting block', block.hash);
        this.blockHandler(block, false, callback);
    }

    // blockHandler stores any transactions with scriptData into a level db
    // in a single atomic operation.
    blockHandler(block, add, callback) {
        let height = block.__height,
            operations = [],
            self = this,
            // Update tip
            tipHash = add ? new Buffer(block.hash, 'hex') : BufferUtil.reverse(block.header.prevHash),
            txIdx = 0,
            txs = block.transactions,
            transactionLength = txs.length;

        operations.push({
            type: 'put',
            key: PREFIX_TIP,
            value: tipHash
        });

        // Loop through every transaction in the block
        for (txIdx; txIdx < transactionLength; txIdx++) {
            let tx = txs[txIdx],
                txid = tx.id,
                outputs = tx.outputs,
                outputLength = outputs.length,
                outputIndex = 0;

            // Loop through every output in the transaction
            for (outputIndex; outputIndex < outputLength; outputIndex++) {
                let output = outputs[outputIndex],
                    script = output.script,
                    scriptData;

                if (!script || !script.isDataOut()) {
                    self.log.debug('Invalid script');
                    continue;
                }

                // If we find outputs with script data, we need to store the transaction into level db
                scriptData = script.getData().toString('hex');
                self.log.info('scriptData added to index:', scriptData);

                // Prepend a prefix to the key to prevent namespacing collisions
                // Append the block height, txid, and outputIndex for ordering purposes (ensures transactions will be returned
                // in the order they occured)
                let action = add ? 'put' : 'del',
                    key = [PREFIX, scriptData, height, txid, outputIndex].join('-'),
                    value = block.hash,
                    operation = {
                        action,
                        key,
                        value
                    };

                operations.push(operation);
            }
        }

        self.log.debug('Updating the database with operations', operations);
        self.store.batch(operations, callback);
    }

    // disconnect will attempt to rewind the chain to the common ancestor
    // between the current chain and a forked block.
    disconnectTip(done) {
        // TODO: expose prevHash as a string from bitcore
        let prevHash = BufferUtil.reverse(tip.header.prevHash).toString('hex'),
            self = this,
            tip = self.tip;

        self.node.getBlock(prevHash, function(err, previousTip) {
            if (err) {
                done(err);
            }

            // Undo the related indexes for this block
            self.disconnectBlock(tip, function(err) {
                if (err) {
                    return done(err);
                }

                // Set the new tip
                previousTip.__height = self.tip.__height - 1;
                self.tip = previousTip;
                self.emit('removeblock', tip);
                done();
            });
        });
    }

    // sync will synchronize additional indexes for the chain based on
    // the current active chain in the bitcoin daemon. In the event that there is
    // a reorganization in the daemon, the chain will rewind to the last common
    // ancestor and then resume syncing.
    sync() {
        let height,
            self = this;

        if (self.bitcoindSyncing || self.node.stopping || !self.tip) {
            return;
        }

        self.bitcoindSyncing = true;


        async.whilst(function() {
            if (self.node.stopping) {
                return false;
            }
            height = self.tip.__height;
            return height < self.node.services.bitcoind.height;
        }, function(done) {
            self.node.getRawBlock(height + 1, function(err, blockBuffer) {
                let block = Block.fromBuffer(blockBuffer);

                if (err) {
                    return done(err);
                }

                // TODO: expose prevHash as a string from bitcore
                let prevHash = BufferUtil.reverse(block.header.prevHash).toString('hex');

                if (prevHash === self.tip.hash) {
                    // This block appends to the current chain tip and we can
                    // immediately add it to the chain and create indexes.

                    // Populate height
                    block.__height = self.tip.__height + 1;

                    // Create indexes
                    self.connectBlock(block, function(err) {
                        if (err) {
                            return done(err);
                        }
                        self.tip = block;
                        self.log.debug('Chain added block to main chain');
                        self.emit('addblock', block);
                        done();
                    });
                } else {
                    // This block doesn't progress the current tip, so we'll attempt
                    // to rewind the chain to the common ancestor of the block and
                    // then we can resume syncing.
                    self.log.warn(`Reorg detected! Current tip: ${self.tip.hash$}`);
                    self.disconnectTip(function(err) {
                        if (err) {
                            return done(err);
                        }
                        self.log.warn(`Disconnected current tip. New tip is ${self.tip.hash}`);
                        done();
                    });
                }
            });
        }, function(err) {
            if (err) {
                Error.captureStackTrace(err);
                return self.node.emit('error', err);
            }

            if (self.node.stopping) {
                self.bitcoindSyncing = false;
                return;
            }

            self.node.isSynced(function(err, synced) {
                if (err) {
                    Error.captureStackTrace(err);
                    return self.node.emit('error', err);
                }

                if (synced) {
                    self.bitcoindSyncing = false;
                    self.node.emit('synced');
                } else {
                    self.bitcoindSyncing = false;
                }
            });
        });
    }

    getRoutePrefix() {
        return 'stampingservice';
    }

    setupRoutes(app) {
        app.get('/hash/:hash', this.lookupHash.bind(this));
        app.get('/address/:address', this.getAddressData.bind(this));
        app.get('/send/:transaction', this.sendTransaction.bind(this));
    }

    // lookupHash is used to determine whether a file hash has
    // already been included in the blockchain. We are querying data
    // from level db that we previously stored into level db via the blockHanlder.
    lookupHash(req, res) {
        let error,
            hash = req.params.hash, // the hash of the uploaded file
            node = this.node,
            objArr = [],
            self = this,
            stream = self.store.createReadStream({
                gte: [PREFIX, hash].join('-'),
                lt: [PREFIX, hash].join('-') + '~'
            });

        enableCors(res);
        this.log.info('request for hash:', hash);

        // Search level db for instances of this file hash
        // and put them in objArr
        stream.on('data', function(data) {
            // Parse data as matches are found and push it
            // to the objArr
            data.key = data.key.split('-');
            let obj = {
                hash: data.value,
                height: data.key[2],
                txid: data.key[3],
                outputIndex: data.key[4]
            };

            objArr.push(obj);
        });


        stream.on('error', function(streamError) {
            // Handle any errors during the search
            if (streamError) {
                error = streamError;
            }
        });

        stream.on('close', function() {
            if (error) {
                return res.send(500, error.message);
            } else if (!objArr.length) {
                return res.sendStatus(404);
            }

            // For each transaction that included our file hash, get additional
            // info from the blockchain about the transaction (such as the timestamp and source address).
            async.each(objArr, function(obj, eachCallback) {
                let txid = obj.txid;

                node.log.info('getting details for txid:', txid);
                node.getDetailedTransaction(txid, function(err, transaction) {
                    let address = transaction.inputs[0].address;

                    if (err) {
                        return eachCallback(err);
                    }

                    obj.sourceAddress = address;
                    obj.timestamp = transaction.blockTimestamp;
                    return eachCallback();
                });
            }, function doneGrabbingTransactionData(err) {
                if (err) {
                    return res.send(500, err);
                }

                // Send back matches to the client
                res.send(objArr);
            });
        });
    }

    // getAddressData is called by the client to determine whether a BTC address
    // has recieved funds yet
    getAddressData(req, res) {
        let address = req.params.address,
            self = this;

        enableCors(res);
        this.node.getAddressUnspentOutputs(address, {}, function(err, unspentOutputs) {
            if (err) {
                return self.log('err', err);
            }
            self.log.info(`Address data (${address}):`, unspentOutputs);
            res.send(unspentOutputs);
        });
    }

    sendTransaction(req, res) {
        let self = this,
            serializedTransaction = req.params.transaction;

        enableCors(res);

        this.node.sendTransaction(serializedTransaction, function(err) {
            if (err) {
                self.log('error sending transaction', err);
                return res.send(500, err);
            }
            res.sendStatus(200);
        });
    }

    start(callback) {
        let self = this;

        if (!fs.existsSync(this.dataPath)) {
            mkdirp.sync(this.dataPath);
        }

        this.genesis = Block.fromBuffer(this.node.services.bitcoind.genesisBuffer);
        this.store = levelup(this.dataPath, {db: this.levelupStore});

        this.once('ready', function() {
            self.log.info('Bitcoin Database Ready');

            self.node.services.bitcoind.on('tip', function() {
                if (!self.node.stopping) {
                    self.sync();
                }
            });
        });

        self.loadTip(function(err) {
            if (err) {
                return callback(err);
            }

            self.sync();
            self.emit('ready');
            callback();
        });
    }

    stop(callback) {
        let self = this;

        // Wait until syncing stops and all db operations are completed before closing leveldb
        async.whilst(function() {
            return self.bitcoindSyncing;
        }, function(next) {
            setTimeout(next, 10);
        }, function() {
            self.store.close(callback);
        });
    }

    getAPIMethods() {
        return [];
    }

    getPublishEvents() {
        return [];
    }
}

StampingService.dependencies = ['bitcoind'];

module.exports = StampingService;

// enableCors ensures the response object supports cross-origin requests.
function enableCors(response) {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, PUT');
    response.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
}
