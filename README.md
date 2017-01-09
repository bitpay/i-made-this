# I Made This - *a Bitcore tutorial project to become familiar with the Bitcore project*


## Intoduction

This repo is based off of the [*I Made This* Bitcore Tutorial](https://bitcore.io/guides/i-made-this).
*I Made This* is an [Electron](http://electron.atom.io) app that leverages [Bitcore](https://bitcore.io) to timestamp files in the blockchain.

*I Made This* allows you to upload a file and timestamp it into the blockchain. This is performed in four parts:

1. Upload your file.
2. Send the provided address 0.005 BTC.
3. The app will make a secondary transaction using the private key of the initial address. This secondary transacton will have the hash of the file encoded in its `OP_RETURN` field.
4. Wait for this secondary transaction to be finalized in the blockchain.

You can view the application flow below.

<p align="center">
  <img src="/screenshots/upload.png" />
  <img src="/screenshots/uploaded.png" />
  <img src="/screenshots/awaiting.png" />
  <img src="/screenshots/stamped.png" />
  <img src="/screenshots/confirming.png" />
  <img src="/screenshots/already-stamped.png" />
</p>


## Getting Started

1. [Install a bitcore node onto your computer.](https://bitcore.io/guides/full-node) This can take several hours to sync with the testnet blockchain. 

2. Clone this repo onto your filesystem.
    * `git clone git@github.com:bitpay/i-made-this.git`

3. Assuming the created Bitcore node is called `mynode` and resides in your home directory, Symlink the i-made-this `stampingservice` into the `node_modules` directory of `~/mynode`.
    * `ln -s ~/mynode/node_modules ~/i-made-this/stampingservice`
    * Notice, this command is reverse on OSX.

4. Add `stampingservice` as a dependency in `~/mynode/bitcore-node.json`:

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

5. Run npm install from within the `stampingservice` directory:
    * `cd ~/i-made-this/stampingservice`
    * `npm install`

6. Start your bitcore-node from within the `~/mynode` directory:
    * `cd ~/mynode`
    * `bitcored`
    * This will begin to sync the testnet blockchain with your local leveldb installation. This can about an hour.

7.  In a new terminal tab or window, run:

```
npm install electron-prebuilt -g

cd i-made-this
npm install
npm run bower-install
npm run gulp-watch
```

This will begin the electron app and monitor you code files for changes.

## Final Notes

To learn how to create this project from scratch, [read the tutorial](https://bitcore.io/guides/i-made-this).
