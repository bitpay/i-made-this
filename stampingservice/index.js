var util = require('util');
var EventEmitter = require('events').EventEmitter;
var async = require('async');

// A prefix for our level db file hash keys to ensure there
// are no collisions the bitcore namespace (0-255 is reserved by bitcore)
var PREFIX = String.fromCharCode(0xff) + 'StampingService';

function enableCors(response){
  // A convenience function to ensure
  // the response object supports cross-origin requests
  response.set('Access-Control-Allow-Origin','*');
  response.set('Access-Control-Allow-Methods','POST, GET, OPTIONS, PUT');
  response.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
}

function StampingService(options) {
  EventEmitter.call(this);
  this.node = options.node;
  this.data = {};
}
util.inherits(StampingService, EventEmitter);

StampingService.dependencies = ['bitcoind', 'db', 'web'];

StampingService.prototype.getAPIMethods = function(){
  return [];
}

StampingService.prototype.getPublishEvents = function(){
  return [];
}

StampingService.prototype.blockHandler = function(block, add, callback) {
  /*

    This blockHandler is called whenever Bitcore node receives a new block from
    the Bitcoin network.

    Let's override the blockHandler to store transactions that have data
    embedded within them (these types of transactions may contain file hashes).

    The code below stores any transactions with scriptData into level db, a key-value
    store that ships with bitcore.

  */
  if (!add) {
    setImmediate(function() {
      callback(null, []);
    });
  }

  var operations = [];
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
        this.node.log.debug('Invalid script');
        continue;
      }

      // If we find outputs with script data, we need to store the transaction into level db
      var scriptData = script.getData().toString('hex');
      this.node.log.info('scriptData added to in-memory index:', scriptData);

      // Prepend a prefix to the key to prevent namespacing collisions
      // Append the block height, txid, and outputIndex for ordering purposes (ensures transactions will be returned
      // in the order they occured)
      var key = [PREFIX, scriptData, height, txid, outputIndex].join('-');
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
  setImmediate(function() {
    // store transactions with script data into level db
    callback(null, operations);
  });
}

StampingService.prototype.getRoutePrefix = function() {
  return 'stampingservice';
}

StampingService.prototype.setupRoutes = function(app) {
  app.get('/hash/:hash', this.lookupHash.bind(this));
  app.get('/address/:address', this.getAddressData.bind(this));
  app.get('/send/:transaction', this.sendTransaction.bind(this));
}

StampingService.prototype.lookupHash = function(req, res, next) {
  /*
    This method is used to determine whether a file hash has
    already been included in the blockchain. We are querying data
    from level db that we previously stored into level db via the blockHanlder.
  */

  enableCors(res);

  var hash = req.params.hash; // the hash of the uploaded file
  var node = this.node;

  // Search level db for instances of this file hash
  // and put them in objArr
  var stream = this.node.services.db.store.createReadStream({
    gte: [PREFIX, hash].join('-'),
    lt: [PREFIX, hash].join('-') + '~'
  });

  var objArr = [];

  stream.on('data', function(data) {
      // Parse data as matches are found and push it
      // to the objArr
      data.key = data.key.split('-');
      obj = {
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
      return res.send(404);
    }

    // For each transaction that included our file hash, get additional
    // info from the blockchain about the transaction (such as the timestamp and source address).
    async.each(objArr, function(obj, eachCallback){
      var txid = obj.txid;
      var includeMempool = true;

      node.services.db.getTransactionWithBlockInfo(txid, includeMempool, function(err, transaction) {
        if(err){
          eachCallback(err);
        }

        var script = transaction.inputs[0].script;
        var address = script.toAddress(node.network).toString();

        obj.sourceAddress = address;
        obj.timestamp = transaction.__timestamp;
        return eachCallback();
      })
    }, function doneGrabbingTransactionData(err){
      if(err){
        return res.send(500, err);
      }

      // Send back matches to the client
      res.send(objArr);
    });

  });
}

StampingService.prototype.getAddressData = function(req, res, next) {
  /*
    This method is called by the client to determine whether a BTC address
    has recieved funds yet
  */
  enableCors(res);
  var addressService = this.node.services.address;
  var address = req.params.address;
  addressService.getUnspentOutputs(address, true, function(err, unspentOutputs) {
    if(err){
      console.log('err', err);
    }

    res.send(unspentOutputs);
  });
}

StampingService.prototype.sendTransaction = function(req, res, next){
  enableCors(res);
  var serializedTransaction = req.params.transaction;

  try {
    this.node.services.bitcoind.sendTransaction(serializedTransaction);
  } catch(err) {
    if(err){
      console.log('error sending transaction', err);
      return res.send(500, err);
    }
  }

  res.send(200);
}

StampingService.prototype.start = function(callback) {
  setImmediate(callback);
}

StampingService.prototype.stop = function(callback) {
  setImmediate(callback);
}

module.exports = StampingService;
