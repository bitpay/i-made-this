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
    var pendingFileHashes = {},
        fileHash,       // a hash of the uploaded file
        pollInterval,   // $interval promise that needs to be canceled if user exits stamping mode
        privateKey;     // the private key of the generated address

    var vm = $scope;

    // view model variables
    vm.previousTimestamps = undefined;
    vm.pendingTimestamp = undefined;
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

            FileService.hash(file, function(fileHashString) {
                fileHash = fileHashString;
                $log.info('fileHash', fileHash);
                FileService.inBlockchain(fileHash)
                    .success(function(data, statusCode) {
                        vm.previousTimestamps = data;
                        vm.previousTimestamps = vm.previousTimestamps.map(function(ts) {
                            ts.date = new Date(ts.timestamp*1000);
                            return ts;
                        });
                    })
                    .error(function(data, statusCode) {
                        if (statusCode === 404) {
                            if (pendingFileHashes[fileHash]) {
                                vm.pendingTimestamp = pendingFileHashes[fileHash];
                            }
                        }
                    });
            });
        }
    });

    // Returns app to zero-state
    function cancel() {
        delete vm.files;
        vm.stampSuccess = false;
        vm.previousTimestamps = [];
        vm.pendingTimestamp = null;
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
        privateKey = new BitcoreService.PrivateKey();
        var publicKey = new BitcoreService.PublicKey(privateKey);

        vm.stamping = true;
        vm.address = new BitcoreService.Address(publicKey, BitcoreService.Networks.testnet).toString();

        monitorAddress(vm.address, function(unspentOutputs) {
            FileService.stamp(unspentOutputs, privateKey, fileHash)
                .then(function(transactionId) {
                    vm.stampSuccess = true;
                    pendingFileHashes[fileHash] = {date: new Date()};
                    vm.transactionId = transactionId;
                })
                .catch(function(transactionId) {
                    vm.transactionId = transactionId;
                });
        });
    }

    // Asks bitcore-node whether the input BTC address has received funds from the user
    function monitorAddress(address, cb) {
        function gotAddressInfo(data, statusCode) {
            if(data.length) {
                var unspentOutput = data[0];
                $interval.cancel(pollInterval);
                cb(unspentOutput);
            }
        }

        pollInterval = $interval(function() {
            $log.info('monitorAddress interval called for address:', address);
            $http.get(SERVICE.BASE_PATH + '/address/' + address)
                .success(gotAddressInfo);
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

function FileService($http, $q, BitcoreService, Upload, SERVICE) {
    return {
        stamp: stamp,
        hash: hash,
        inBlockchain: inBlockchain
    }

    // Uses the BTC received from the user to create a new transaction object
    // that includes the hash of the uploaded file
    function stamp(unspentOutput, privateKey, fileHash) {
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
                return transaction2.id;
            })
            .catch(function() {
                return $q.reject(transaction2.id);
            });
    }

    function hash(file, cb) {
        Upload.base64DataUrl(file).then(function(urls) {
            var Buffer = BitcoreService.deps.Buffer,
                data = new Buffer(urls, 'base64'),
                hash = BitcoreService.crypto.Hash.sha256sha256(data),
                hashString = hash.toString('hex');
            return cb(hashString);
        });
    }

    // Asks bitcore-node if the hash of the uploaded file has been timestamped in the bockchain before
    function inBlockchain(fileHashString) {
        return $http.get(SERVICE.BASE_PATH + '/hash/' + fileHashString);
    }
}
