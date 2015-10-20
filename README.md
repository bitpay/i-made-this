# i-made-this

This repo contains the completed project files for the i-made-this Bitcore tutorial. Download this project with:

`git clone git@github.com:bitpay/i-made-this.git`

To learn how to create this project yourself, read the [tutorial](http://www.bitcore.io/i-made-this).


___


# i-made-this tutorial

In this tutorial, we will build a Desktop app that will communicate with the blockchain to timestamp original files (without publicly revealing file contents). The timestamp will serve as immutable proof that the files existed at a certain point in time, which can be used to demonstrate ownership of copyrighted material.

#### Here is what we will build:

1. A [Bitcore](http://bitcore.io/) server to communicate with the blockchain
2. A custom Bitcore service to extend your Bitcore server so that it can stamp files and search for them
3. [Electron](http://electron.atom.io) and [AngularJS](https://angularjs.org/) to serve as the Desktop UI to communicate with your Bitcore server

### Setting up your Bitcore node
To set up your Bitcore server, follow the instructions in [this tutorial]().

### Extending your Bitcore node with a custom service
Before continuing with this section, please review the basics of custom Bitcore services [here]().
