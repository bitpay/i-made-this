'use strict';

var util = require('util'),
    EventEmitter = require('events').EventEmitter,
    fs = require('fs'),
    async = require('async'),
    levelup = require('levelup'),
    leveldown = require('leveldown'),
    mkdirp = require('mkdirp'),
    bitcore = require('bitcore-lib'),
    BufferUtil = bitcore.util.buffer,
    Networks = bitcore.Networks,
    Block = bitcore.Block,
    $ = bitcore.util.preconditions;

function StampingService(options) {
    if (!(this instanceof StampingService)) {
        return new StampingService(options);
    }
    if (!options) {
        options = {};
    }

    this.node = options.node;
    this.name = options.name;

    EventEmitter.call(this);

    this.tip = null;
    this.genesis = null;

    $.checkState(this.node.network, 'Node is expected to have a "network" property');
    this.network = this.node.network;

    this._setDataPath();

    this.levelupStore = leveldown;
    if (options.store) {
        this.levelupStore = options.store;
    }
    this.retryInterval = 60000;
    this.log = this.node.log;
}

util.inherits(StampingService, EventEmitter);

StampingService.dependencies = ['bitcoind'];

StampingService.PREFIX_TIP = new Buffer('04', 'hex');
StampingService.PREFIX = String.fromCharCode(0xff);

// _setDataPath sets `this.dataPath` based on `this.node.network`.
StampingService.prototype._setDataPath = function() {
    $.checkState(this.node.services.bitcoind.spawn.datadir, 'bitcoind is expected to have a "spawn.datadir" property');
    var datadir = this.node.services.bitcoind.spawn.datadir;
    if (this.node.network === Networks.livenet) {
        this.dataPath = datadir + '/bitcore-stamps.db';
    } else if (this.node.network === Networks.testnet) {
        if (this.node.network.regtestEnabled) {
            this.dataPath = datadir + '/regtest/bitcore-stamps.db';
        } else {
            this.dataPath = datadir + '/testnet3/bitcore-stamps.db';
        }
    } else {
        throw new Error('Unknown network: ' + this.network);
    }
};

StampingService.prototype.loadTip = function(callback) {
  var self = this;

  var options = {
    keyEncoding: 'binary',
    valueEncoding: 'binary'
  };

  self.store.get(StampingService.PREFIX_TIP, options, function(err, tipData) {
    if(err && err instanceof levelup.errors.NotFoundError) {
      self.tip = self.genesis;
      self.tip.__height = 0;
      self.connectBlock(self.genesis, function(err) {
        if(err) {
          return callback(err);
        }

        self.emit('addblock', self.genesis);
        callback();
      });
      return;
    } else if(err) {
      return callback(err);
    }

    var hash = tipData.toString('hex');

    var times = 0;
    async.retry({times: 3, interval: self.retryInterval}, function(done) {
      self.node.getBlock(hash, function(err, tip) {
        if(err) {
          times++;
          self.log.warn('Bitcoind does not have our tip (' + hash + '). Bitcoind may have crashed and needs to catch up.');
          if(times < 3) {
            self.log.warn('Retrying in ' + (self.retryInterval / 1000) + ' seconds.');
          }
          return done(err);
        }

        done(null, tip);
      });
    }, function(err, tip) {
      if(err) {
        self.log.warn('Giving up after 3 tries. Please report this bug to https://github.com/bitpay/bitcore-node/issues');
        self.log.warn('Please reindex your database.');
        return callback(err);
      }

      self.tip = tip;
      self.node.getBlockHeader(self.tip.hash, function(err, blockHeader) {
        if (err) {
          return callback(err);
        }
        if(!blockHeader) {
          return callback(new Error('Could not get height for tip.'));
        }
        self.tip.__height = blockHeader.height;
        callback();
      });

    });
  });
};

/**
 * Connects a block to the database and add indexes
 * @param {Block} block - The bitcore block
 * @param {Function} callback
 */
StampingService.prototype.connectBlock = function(block, callback) {
  this.log.info('adding block', block.hash);
  this.blockHandler(block, true, callback);
};

/**
 * Disconnects a block from the database and removes indexes
 * @param {Block} block - The bitcore block
 * @param {Function} callback
 */
StampingService.prototype.disconnectBlock = function(block, callback) {
  this.log.info('disconnecting block', block.hash);
  this.blockHandler(block, false, callback);
};

// blockHandler stores any transactions with scriptData into a level db
// in a single atomic operation.
StampingService.prototype.blockHandler = function(block, add, callback) {
    var self = this;

    var operations = [];

    // Update tip
    var tipHash = add ? new Buffer(block.hash, 'hex') : BufferUtil.reverse(block.header.prevHash);
    operations.push({
        type: 'put',
        key: StampingService.PREFIX_TIP,
        value: tipHash
    });

    var txs = block.transactions;
    var height = block.__height;

    // Loop through every transaction in the block
    var transactionLength = txs.length;
    for (var i = 0; i < transactionLength; i++) {
        var tx = txs[i];
        var txid = tx.id;
        var outputs = tx.outputs;
        var outputScriptHashes = {};
        var outputLength = outputs.length;

        // Loop through every output in the transaction
        for (var outputIndex = 0; outputIndex < outputLength; outputIndex++) {
            var output = outputs[outputIndex];
            var script = output.script;

            if(!script || !script.isDataOut()) {
                self.log.debug('Invalid script');
                continue;
            }

            // If we find outputs with script data, we need to store the transaction into level db
            var scriptData = script.getData().toString('hex');
            self.log.info('scriptData added to index:', scriptData);

            // Prepend a prefix to the key to prevent namespacing collisions
            // Append the block height, txid, and outputIndex for ordering purposes (ensures transactions will be returned
            // in the order they occured)
            var key = [StampingService.PREFIX, scriptData, height, txid, outputIndex].join('-');
            var value = block.hash;

            var action = add ? 'put' : 'del';
            var operation = {
                type: action,
                key: key,
                value: value
            };

            operations.push(operation);
        }
    }

    self.log.debug('Updating the database with operations', operations);
    self.store.batch(operations, callback);
};

// disconnect will attempt to rewind the chain to the common ancestor
// between the current chain and a forked block.
StampingService.prototype.disconnectTip = function(done) {
    var self = this;

    var tip = self.tip;

    // TODO: expose prevHash as a string from bitcore
    var prevHash = BufferUtil.reverse(tip.header.prevHash).toString('hex');

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
};

// sync will synchronize additional indexes for the chain based on
// the current active chain in the bitcoin daemon. In the event that there is
// a reorganization in the daemon, the chain will rewind to the last common
// ancestor and then resume syncing.
StampingService.prototype.sync = function() {
    var self = this;

    if (self.bitcoindSyncing || self.node.stopping || !self.tip) {
        return;
    }

    self.bitcoindSyncing = true;

    var height;

    async.whilst(function() {
        if (self.node.stopping) {
            return false;
        }
        height = self.tip.__height;
        return height < self.node.services.bitcoind.height;
    }, function(done) {
        self.node.getRawBlock(height + 1, function(err, blockBuffer) {
            if (err) {
                return done(err);
            }

            var block = Block.fromBuffer(blockBuffer);

            // TODO: expose prevHash as a string from bitcore
            var prevHash = BufferUtil.reverse(block.header.prevHash).toString('hex');

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
                self.log.warn('Reorg detected! Current tip: ' + self.tip.hash);
                self.disconnectTip(function(err) {
                    if(err) {
                        return done(err);
                    }
                    self.log.warn('Disconnected current tip. New tip is ' + self.tip.hash);
                    done();
                });
            }
        });
    }, function(err) {
        if (err) {
            Error.captureStackTrace(err);
            return self.node.emit('error', err);
        }

        if(self.node.stopping) {
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

};

StampingService.prototype.getRoutePrefix = function() {
    return 'stampingservice';
};

StampingService.prototype.setupRoutes = function(app) {
    app.get('/hash/:hash', this.lookupHash.bind(this));
    app.get('/address/:address', this.getAddressData.bind(this));
    app.get('/send/:transaction', this.sendTransaction.bind(this));
};

// lookupHash is used to determine whether a file hash has
// already been included in the blockchain. We are querying data
// from level db that we previously stored into level db via the blockHanlder.
StampingService.prototype.lookupHash = function(req, res, next) {
    var self = this;
    enableCors(res);

    var hash = req.params.hash; // the hash of the uploaded file
    this.log.info('request for hash:', hash);
    var node = this.node;

    // Search level db for instances of this file hash
    // and put them in objArr
    var stream = self.store.createReadStream({
        gte: [StampingService.PREFIX, hash].join('-'),
        lt: [StampingService.PREFIX, hash].join('-') + '~'
    });

    var objArr = [];

    stream.on('data', function(data) {
        // Parse data as matches are found and push it
        // to the objArr
        data.key = data.key.split('-');
        var obj = {
            hash: data.value,
            height: data.key[2],
            txid: data.key[3],
            outputIndex: data.key[4]
        };
        objArr.push(obj);
    });

    var error;

    stream.on('error', function(streamError) {
        // Handle any errors during the search
        if (streamError) {
            error = streamError;
        }
    });

    stream.on('close', function() {
        if (error) {
            return res.send(500, error.message);
        } else if(!objArr.length) {
            return res.sendStatus(404);
        }

        // For each transaction that included our file hash, get additional
        // info from the blockchain about the transaction (such as the timestamp and source address).
        async.each(objArr, function(obj, eachCallback) {
            var txid = obj.txid;
            var includeMempool = true;

            node.log.info('getting details for txid:', txid);
            node.getDetailedTransaction(txid, function(err, transaction) {
                if (err) {
                    return eachCallback(err);
                }
                var address = transaction.inputs[0].address;

                obj.sourceAddress = address;
                obj.timestamp = transaction.blockTimestamp;
                return eachCallback();
            });
        }, function doneGrabbingTransactionData(err) {
            if (err){
                return res.send(500, err);
            }

            // Send back matches to the client
            res.send(objArr);
        });

    });
};

// getAddressData is called by the client to determine whether a BTC address
// has recieved funds yet
StampingService.prototype.getAddressData = function(req, res, next) {
    var self = this;
    enableCors(res);
    var address = req.params.address;
    this.node.getAddressUnspentOutputs(address, {}, function(err, unspentOutputs) {
        if (err){
            return self.log('err', err);
        }
        self.log.info('Address data (' + address + '):', unspentOutputs);
        res.send(unspentOutputs);
    });
};

StampingService.prototype.sendTransaction = function(req, res, next){
    enableCors(res);
    var self = this;
    var serializedTransaction = req.params.transaction;

    this.node.sendTransaction(serializedTransaction, function(err) {
        if (err){
            self.log('error sending transaction', err);
            return res.send(500, err);
        }
        res.sendStatus(200);
    });
};

StampingService.prototype.start = function(callback) {
    var self = this;
    if (!fs.existsSync(this.dataPath)) {
        mkdirp.sync(this.dataPath);
    }

    this.genesis = Block.fromBuffer(this.node.services.bitcoind.genesisBuffer);
    this.store = levelup(this.dataPath, { db: this.levelupStore });

    this.once('ready', function() {
        self.log.info('Bitcoin Database Ready');

        self.node.services.bitcoind.on('tip', function() {
            if(!self.node.stopping) {
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

};

StampingService.prototype.stop = function(callback) {
    var self = this;

    // Wait until syncing stops and all db operations are completed before closing leveldb
    async.whilst(function() {
        return self.bitcoindSyncing;
    }, function(next) {
        setTimeout(next, 10);
    }, function() {
        self.store.close(callback);
    });
};

StampingService.prototype.getAPIMethods = function() {
    return [];
};

StampingService.prototype.getPublishEvents = function() {
    return [];
};

module.exports = StampingService;

// enableCors ensures the response object supports cross-origin requests.
function enableCors(response) {
    response.set('Access-Control-Allow-Origin','*');
    response.set('Access-Control-Allow-Methods','POST, GET, OPTIONS, PUT');
    response.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
}
