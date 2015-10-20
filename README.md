# i-made-this

This repo contains the completed project files for the i-made-this Bitcore tutorial. Download this project with:

`git clone git@github.com:bitpay/i-made-this.git`

To learn how to create this project yourself, read the [tutorial](http://www.bitcore.io/i-made-this).


___


# i-made-this tutorial

In this tutorial, we will build a Desktop app that will communicate with the blockchain to timestamp original files. The timestamp will serve as immutable proof that the files existed at a certain point in time, which can be used to demonstrate ownership of copyrighted material. You can view the completed project files [here](https://github.com/bitpay/i-made-this).

#### What we need

1. A [Bitcore](http://bitcore.io/) node to communicate with the blockchain
2. A custom Bitcore service to extend your Bitcore node so that it can timestamp files
3. [Electron](http://electron.atom.io) and [AngularJS](https://angularjs.org/) to serve as the Desktop UI to communicate with your Bitcore server

#### How it works
1. The user uploads a file via the UI.
2. The UI hashes the file and asks Bitcore node whether the file hash already been timestamped in the blockchain.
3. If the file has not yet been timestamped, the UI generates a new BTC address and displays that address to the user in the form of a qrcode, prompting the user to send a small amount of BTC to that address.
4. Once the user's BTC arrives at the address, Bitcore node utilizes the user's BTC to broadcast a new transaction with the file hash included, serving as a permanent timestamp in the blockchain.


### Starting your project

In you terminal, enter:

```
mkdir i-made-this
cd i-made-this

```

### Setting up your Bitcore node
To set up your Bitcore node, follow the instructions in [this tutorial](). Be sure to configure your Bitcore node to run on [testnet](https://en.bitcoin.it/wiki/Testnet) to avoid spending real bitcoins during development.

Start your new Bitcore node from within the newly created `mynode` directory (the start command must always be executed from within the `mynode` directory):

```
cd mynode
bitcore-node start
```

You should now see your Bitcore node begin to download the testnet blockchain (this can take up to 1 hour):
```
{bitcore-node} info: Starting bitcoind
{bitcore-node} info: Bitcoin Daemon Ready
{bitcore-node} info: Starting db
{bitcore-node} info: Bitcoin Database Ready
{bitcore-node} info: Starting address
{bitcore-node} info: Starting web
{bitcore-node} info: Bitcore Node ready
{bitcore-node} info: Bitcoin Core Daemon New Height: 88 Percentage: 0.004769453313201666
{bitcore-node} info: Bitcoin Core Daemon New Height: 193 Percentage: 0.010396335273981094
{bitcore-node} info: Bitcoin Core Daemon New Height: 304 Percentage: 0.01634475402534008
```

### Extending your Bitcore node with a custom service
Before continuing with this section, please review the basics of custom Bitcore services [here]().

To create your custom Bitcore timestamping service, create a new `stampingservice` directory in your project root:

```
cd ~/i-made-this
mkdir stampingservice
cd stampingservice
nano index.js
```

Place the following code into `index.js`

```javascript
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

```

Symlink your `stampingservice` into the node_modules directory of `mynode`

```
cd ~/i-made-this/mynode/node_modules
ln -s ~/i-made-this/stampingservice
```

Add `StampingService` as a dependency in `mynode/bitcore-node.json`

```json
{
  "datadir": "./data",
  "network": "testnet",
  "port": 3001,
  "services": [
    "bitcoind",
    "db",
    "address",
    "web",
    "StampingService"
  ]
}
```

Restart your Bitcore node, and visit `http://localhost:3001/stampingservice/hash/aCrAzYHaSh` in your browser. If all went well, the server response will be `false`.
