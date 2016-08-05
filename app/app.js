'use strict';

angular
    .module('app', ['ngFileUpload', 'monospaced.qrcode'])
    .factory('BitcoreService', BitcoreService)
    .factory('FileService', FileService)
    .controller('AppController', AppController)
    .constant('SERVICE', {
        LOCAL_NODE_BASE_PATH: 'http://localhost:3001/stampingservice',
        EXTERNAL_INSIGHT_BASE_PATH: 'https://test-insight.bitpay.com/tx/'
    });

function AppController($scope, $window, $http, $interval, BitcoreService, FileService, SERVICE) {
    var pollInterval;   // $interval promise that needs to be canceled if user exits stamping mode

    var vm = $scope;

    // view model variables
    vm.previousHash = undefined; // If the file has been hashed before, then store it here.
                                 // This is an object with a hashVal, timestamp, date, etc..
    vm.pendingHash = undefined;  // If the file's hash is pending, then store it here.
                                 // This is an object with a hashVal, timestamp, date, etc..
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

    // Watch for a new file. When a new file is added, it will be hashed
    // and the block chain will be checked for this hash to determine
    // if there are previous or pending hashes.
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
                    vm.pendingHash = pending;
                });
        }
    });

    // cancel re-initializes the app.
    function cancel() {
        delete vm.files;
        vm.stampSuccess = false;
        vm.previousHash = undefined;
        vm.pendingHash = undefined;
        vm.cancelStamp();
    }

    // cancelStomp exits stamping mode for the current file.
    function cancelStamp() {
        vm.stamping = false;
        $interval.cancel(pollInterval);
    }

    // stampFile generates a BTC address, so the user can send the app BTC for timestamping.
    // Once the app has received the BTC, it will use the FileService.stamp function and the
    // generated private key to send a seperate transaction with the file hash.
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
            $http.get(SERVICE.LOCAL_NODE_BASE_PATH + '/address/' + address)
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
        require('shell').openExternal(SERVICE.EXTERNAL_INSIGHT_BASE_PATH + transactionId);
    }

    // These window events prevent files that are dragged into
    // the electron browserwindow from being loaded into the
    // browser if we are not in the preliminary upload state.
    $window.addEventListener("dragover",function(e) {
        e = e || event;
        e.preventDefault();
    },false);
    $window.addEventListener("drop",function(e) {
        e = e || event;
        e.preventDefault();
    },false);
}

// BitcoreService wraps the bitcore-lib for DI purposes.
function BitcoreService() {
    return require('bitcore-lib');
}

// FileService provides an interface into stamping files onto the testnet blockchain.
function FileService($http, $q, BitcoreService, Upload, SERVICE) {
    var hashVal = undefined,    // hashVal represents the hash of the most recently hashed file.
        pendingHashes = {};     // pendingHashes are the hashes of transactions
                                // that are currently pending on the blockchain.
                                // This is a group of date values keyed by hashVal.
    return {
        stamp: stamp,
        hash: hash,
        inBlockchain: inBlockchain
    };

    // stamp uses the BTC received from the user to create a new transaction object
    // that includes the hash of the uploaded file.
    function stamp(unspent, privateKey) {
        unspent = BitcoreService.Transaction.UnspentOutput(unspent);

        // Create a transaction that sends all recieved BTC to a miner.
        var transaction = BitcoreService.Transaction();
        transaction
            .from(unspent)
            .fee(50000);

        // Append the hash of the file to the transaction.
        transaction.addOutput(new BitcoreService.Transaction.Output({
            script: BitcoreService.Script.buildDataOut(hashVal, 'hex'),
            satoshis: 0
        }));

        // Sign transaction with the original private key that generated
        // the address to which the user sent BTC.
        transaction.sign(privateKey);

        // Send the transaction and add the hash as a pending hash.
        return $http.get(SERVICE.LOCAL_NODE_BASE_PATH + '/send/' + transaction.uncheckedSerialize())
            .then(function() {
                pendingHashes[hashVal] = {date: new Date()};
                return transaction.id;
            })
            .catch(function() {
                return $q.reject(transaction.id);
            });
    }

    // hash performs a SHA256 hash on the incoming file and stores the hash
    // in the service level hash variable.
    function hash(file) {
        return Upload.base64DataUrl(file)
            .then(function(urls) {
                var data = new BitcoreService.deps.Buffer(urls, 'base64');
                hashVal = BitcoreService.crypto.Hash.sha256sha256(data).toString('hex');
                return hashVal
            });
    }

    // inBlockchain determines if the given hash has been previously in the blockchain
    // or if its processing is still pending in the blockchain.
    function inBlockchain(hashVal) {
        return $http.get(SERVICE.LOCAL_NODE_BASE_PATH + '/hash/' + hashVal)
            .then(function(http) {
                // TODO: Currently, pending hashes will stay around until the app is
                // restarted. This list of blockchain hashes should be search through
                // to determine if any pending hashes have been completed.
                return $q.when({previous: http.data[0], pending: pendingHashes[hashVal] ? pendingHashes[hashVal] : undefined});
            })
            .catch(function(http) {
                if (http.status == 404 && pendingHashes[hashVal]) {
                    return $q.reject(pendingHashes[hashVal]);
                }
                return $q.reject(undefined);
            });
    }
}
