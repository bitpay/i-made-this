'use strict';

angular
    .module('app', ['ngFileUpload', 'monospaced.qrcode'])
    .factory('BitcoreService', BitcoreService)
    .factory('FileService', FileService)
    .controller('AppController', AppController)
    .constant('SERVICE', {
        BASE_PATH: 'http://localhost:3001/stampingservice'
    });

function AppController($scope, $window, $log, $http, $interval, BitcoreService, FileService, SERVICE) {
    var pollInterval;   // $interval promise that needs to be canceled if user exits stamping mode

    var vm = $scope;

    // view model variables
    vm.previousHash = undefined; // was this file previously stamped?
    vm.pendingHash = undefined;  // is this file's stamp being processed?
    vm.files = undefined;
    vm.fileType = undefined;
    vm.fileExtension = undefined;
    vm.stampSuccess = undefined;
    vm.stamping = undefined;
    vm.address = undefined;
    vm.transactionId = undefined;

    // view model functions
    vm.cancel = cancel;
    vm.stampFile = stampFile;
    vm.cancelStamp = cancelStamp;
    vm.openTransactionInBrowser = openTransactionInBrowser;

    // Wait for the user to upload a file
    $scope.$watch('files', function() {
        if (vm.files && vm.files[0]) {
            var file = vm.files[0],
                typeToks = file.type.split('/'),
                nameToks = file.name.split('.'),
                ext = nameToks[nameToks.length - 1];

            vm.fileType = typeToks[0];
            vm.fileExtension = ext;

            FileService.hash(file)
                .then(FileService.inBlockchain)
                .then(function(hashes) {
                    hashes.previous.date = new Date(hashes.previous.timestamp*1000);
                    vm.previousHash = hashes.previous;
                    vm.pendingHash = hashes.pending;
                })
                .catch(function(pending) {
                    vm.pendingHash = hashes.pending;
                });
        }
    });

    // Returns app to zero-state
    function cancel() {
        delete vm.files;
        vm.stampSuccess = false;
        vm.previousHash = undefined;
        vm.pendingHash = undefined;
        vm.cancelStamp();
    }

    // Exits stamping mode for the current file
    function cancelStamp() {
        vm.stamping = false;
        $interval.cancel(pollInterval);
    }

    // Generates a BTC address to be displayed by the qrcode so
    // that the user can send the app enough BTC for timestamping
    function stampFile() {
        var privateKey = new BitcoreService.PrivateKey(),
            publicKey = new BitcoreService.PublicKey(privateKey);

        vm.stamping = true;
        vm.address = new BitcoreService.Address(publicKey, BitcoreService.Networks.testnet).toString();

        // Wait for the BTC to be received, then stamp the file.
        monitorAddress(vm.address, function(unspentOutputs) {
            FileService.stamp(unspentOutputs, privateKey)
                .then(function(transactionId) {
                    vm.stampSuccess = true;
                    vm.transactionId = transactionId;
                })
                .catch(function(transactionId) {
                    vm.transactionId = transactionId;
                });
        });
    }

    // Asks bitcore-node whether the input BTC address has received funds from the user
    function monitorAddress(address, cb) {
        pollInterval = $interval(function() {
            $http.get(SERVICE.BASE_PATH + '/address/' + address)
                .then(function(http) {
                    if (http.data.length) {
                        var unspentOutput = http.data[0];
                        $interval.cancel(pollInterval);
                        cb(unspentOutput);
                    }
                });
        }, 1000);
    }

    function openTransactionInBrowser(transactionId) {
        require('shell').openExternal('https://test-insight.bitpay.com/tx/' + transactionId);
    }

    // Prevent files that are dragged into the electron browser window
    // from being loaded into the browser if we are not in the preliminary
    // upload state
    $window.addEventListener("dragover",function(e) {
        e = e || event;
        e.preventDefault();
    },false);
    $window.addEventListener("drop",function(e) {
        e = e || event;
        e.preventDefault();
    },false);
}

function BitcoreService() {
    return require('bitcore-lib');
}

function FileService($http, $q, $log, BitcoreService, Upload, SERVICE) {
    var fileHash = undefined,    // fileHash represents the most recently hashed file.
        pendingHashes = {};      // pendingHashes are the timestamps of transactions
                                 // that are currently pending on the blockchain.
    return {
        stamp: stamp,
        hash: hash,
        inBlockchain: inBlockchain
    };

    // Uses the BTC received from the user to create a new transaction object
    // that includes the hash of the uploaded file
    function stamp(unspentOutput, privateKey) {
        var Transaction = BitcoreService.Transaction,
            unspent2 = BitcoreService.Transaction.UnspentOutput(unspentOutput);

        // Let's create a transaction that sends all recieved BTC to a miner
        // (no coins will go to a change address)
        var transaction2 = Transaction();
        transaction2
            .from(unspent2)
            .fee(50000);

        // Append the hash of the file to the transaction
        transaction2.addOutput(new Transaction.Output({
            script: BitcoreService.Script.buildDataOut(fileHash, 'hex'),
            satoshis: 0
        }));

        // Sign transaction with the original private key that generated
        // the address to which the user sent BTC
        transaction2.sign(privateKey);
        return $http.get(SERVICE.BASE_PATH + '/send/' + transaction2.uncheckedSerialize())
            .then(function() {
                pendingHashes[fileHash] = {date: new Date()};
                return transaction2.id;
            })
            .catch(function() {
                return $q.reject(transaction2.id);
            });
    }

    function hash(file) {
        return Upload.base64DataUrl(file)
            .then(function(urls) {
                var Buffer = BitcoreService.deps.Buffer,
                    data = new Buffer(urls, 'base64');
                fileHash = BitcoreService.crypto.Hash.sha256sha256(data).toString('hex');
                return fileHash
            });
    }

    // inBlockchain determines if the given hash has been previously in the blockchain
    // or if its processing is still pending in the blockchain.
    function inBlockchain(fileHash) {
        return $http.get(SERVICE.BASE_PATH + '/hash/' + fileHash)
            .then(function(http) {
                return $q.when({previous: http.data[0], pending: pendingHashes[fileHash] ? pendingHashes[fileHash] : undefined});
            })
            .catch(function(http) {
                if (http.status == 404 && pendingHashes[fileHash]) {
                    return $q.reject(pendingHashes[fileHash]);
                }
                return $q.reject(undefined);
            });
    }
}
