var util = require('util');
var EventEmitter = require('events').EventEmitter;

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

StampingService.prototype.blockHandler = function(block, addOutput, callback) {
  if (!addOutput) {
    setImmediate(function() {
      // we send an empty array back to the db service because this will be in-memory only
      callback(null, []);
    });
  }
  var txs = block.transactions;
  var height = block.__height;

  var transactionLength = txs.length;
  for (var i = 0; i < transactionLength; i++) {
    var tx = txs[i];
    var txid = tx.id;
    var outputs = tx.outputs;
    var outputScriptHashes = {};
    var outputLength = outputs.length;

    for (var outputIndex = 0; outputIndex < outputLength; outputIndex++) {
      var output = outputs[outputIndex];
      var script = output.script;

      if(!script || !script.isDataOut()) {
        this.node.log.debug('Invalid script');
        continue;
      }

      var scriptData = script.getData().toString('hex');
      this.node.log.info('scriptData added to in-memory index:', scriptData);
      this.data[scriptData] = {
        blockHash: block.hash,
        height: height,
        outputIndex: outputIndex,
        tx: txid
      };
    }
  }
  setImmediate(function() {
    //we send an empty array back to the db service because this will be in-memory only
    callback(null, []);
  });
}

StampingService.prototype.getRoutePrefix = function() {
  return 'stampingservice';
}

StampingService.prototype.setupRoutes = function(app) {
  app.get('/hash/:hash', this.lookupHash.bind(this));
}

StampingService.prototype.lookupHash = function(req, res, next) {
  var hash = req.params.hash;
  res.send(this.data[hash] || false);
}

StampingService.prototype.start = function(callback) {
  setImmediate(callback);
}

StampingService.prototype.stop = function(callback) {
  setImmediate(callback);
}

module.exports = StampingService;
