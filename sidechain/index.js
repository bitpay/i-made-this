var index = require('../../node_modules/bitcore-node');
var log = index.log;
var util = require('util');
var Service = require('../../node_modules/bitcore-node/lib/service');


function SideChain(options) {
  Service.call(this, options);

  this.operations = {};
}

/*
 * We are going to need bitcoind because we will be setting event listeners (subscribers)
 * on Blocks and such
 */
SideChain.dependencies = ['bitcoind', 'db', 'web'];

/*
 * inherits the serivce base class so we get some stuff for free
 */
util.inherits(SideChain, Service);

/*
 * start: REQUIRED!! Ours just calls the callback
 */
SideChain.prototype.start = function(callback) {
  callback();
}

/*
 * stop: REQUIRED!! Ours just calls the callback
 */
SideChain.prototype.stop = function(callback) {
  callback();
}

/*
 * blockHandler: this handler will get called when a block comes in
 * this will keep an index of script hashes
 */

SideChain.prototype.blockHandler = function(block, addOutput, callback) {
  if (!addOutput) {
    setImmediate(function() {
      callback(null, []); //we send an empty array back to the db service because this will be in-memory only
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
        log.debug('Invalid script');
        continue;
      }

      var scriptData = script.getData().toString('hex');
      log.info( "scriptData added to in-memory index: ", scriptData);

      this.operations[scriptData] = {
        blockHash: block.hash,
        height: height,
        outputIndex: outputIndex,
        tx: txid
      };

    }
  }
  setImmediate(function() {
    callback(null, []); //we send an empty array back to the db service because this will be in-memory only
  });
}

SideChain.prototype.setupRoutes = function(app) {
  app.get('/hash/:hash', this.lookupHash.bind(this));
}

SideChain.prototype.lookupHash = function(req, res, next) {
  var hash = req.params.hash;
  res.send(this.operations[hash] || false);
}

module.exports = SideChain;

