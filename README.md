# I Made This

This repo contains the completed project files for the [*I Made This* Bitcore tutorial](https://bitcore.io/guides/i-made-this). *I Made This* is an [electron](http://electron.atom.io) app that leverages [Bitcore](https://bitcore.io) to timestamp files in the blockchain.

Download this project with:

`git clone git@github.com:bitpay/i-made-this.git`

<p align="center">
  <img src="/screenshot.png" />
</p>

## Install

#### Install and Run Bitcore Node
[Follow this guide](https://bitcore.io/guides/full-node) to install and run a full Bitcore node.

Assuming the created Bitcore node is called `mynode` and resides in your home directory, Symlink the i-made-this `stampingservice` into the node_modules directory of `~/mynode`

```
cd ~/mynode/node_modules
ln -s ~/i-made-this/stampingservice
```

Add `stampingservice` as a dependency in `~/mynode/bitcore-node.json`

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
    "stampingservice"
  ]
}
```

Run npm install from within the `stampingservice` directory:

```
cd ~/i-made-this/stampingservice
npm install
```

Start your bitcore-node from within the ```~/mynode``` directory

```
cd ~/mynode
bitcore-node start
```

#### Install the Electron App

In a new terminal tab or window, run:
```
npm install electron-prebuilt -g

cd i-made-this
npm install
bower install
electron .
```

To learn how to create this project from scratch, [read the tutorial](http://www.bitcore.io/guides/i-made-this).
