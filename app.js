'use strict';
var bitcore;
angular.module('iMadeThis', ['ngFileUpload', 'monospaced.qrcode'])

.run( function run () {
  bitcore = require('bitcore-lib');
})

.controller('MyCtrl', ['$scope', 'Upload', '$http', '$interval',
 function ($scope, Upload, $http, $interval) {

    var bitcoreServiceBasePath = 'http://localhost:3001/stampingservice';
    var pendingFileHashes = {};

    var file; // represents the uploaded file
    var fileHash; // a hash of the uploaded file
    var pollInterval; // $interval promise that needs to be canceled if user exits stamping mode
    var privateKey; // the private key of the generated address

    function hashFile(file, cb){
      Upload.base64DataUrl(file).then(function(urls){
        var Buffer = bitcore.deps.Buffer;
        var data = new Buffer(urls, 'base64');
        var hash = bitcore.crypto.Hash.sha256sha256(data);
        var hashString = hash.toString('hex');
        return cb(hashString);
      });
    }

    function isFileInBlockchain(fileHashString){
      // Asks bitcore-node if the hash of the uploaded file has been timestamped in the bockchain before
      $http.get(bitcoreServiceBasePath + '/hash/' + fileHashString)
        .success(gotFile)
        .error(didNotGetFile);

      function gotFile(data, statusCode){
        $scope.previousTimestamps = data;
        $scope.previousTimestamps = $scope.previousTimestamps.map(function(ts){
          ts.date = new Date(ts.timestamp*1000);
          return ts;
        });
      }

      function didNotGetFile(data, statusCode){
        if(statusCode === 404){
          if(pendingFileHashes[fileHash]){
            $scope.pendingTimestamp = pendingFileHashes[fileHash];
          }
        }
      }
    }

    $scope.$watch('files', function () {
      // Wait for the user to upload a file
      if($scope.files && $scope.files[0]){
       file = $scope.files[0];
       var typeToks = file.type.split('/');
       var nameToks = file.name.split('.');
       var ext = nameToks[nameToks.length - 1];
       $scope.fileType = typeToks[0];
       $scope.fileExtension = ext;

       hashFile(file, function(fileHashString){
         fileHash = fileHashString;
         console.log('fileHash', fileHash);
         isFileInBlockchain(fileHash);
       });
      }
    });

    $scope.cancel = function(){
      // Returns app to zero-state
      delete $scope.files;
      $scope.stampSuccess = false;
      $scope.previousTimestamps = [];
      $scope.pendingTimestamp = null;
      $scope.cancelStamp();
    };

    $scope.cancelStamp = function(){
      // Exits stamping mode for the current file
      $scope.stamping = false;
      $interval.cancel(pollInterval);
    };

    $scope.stampFile = function(){
      // Generates a BTC address to be displayed by the qrcode so
      // that the user can send the app enough BTC for timestamping
      $scope.stamping = true;

      privateKey = new bitcore.PrivateKey();
      var publicKey = new bitcore.PublicKey(privateKey);
      $scope.address = new bitcore.Address(publicKey, bitcore.Networks.testnet).toString();

      montiorAddress($scope.address, function(unspentOutputs){
        timeStampFile(unspentOutputs, privateKey);
      });

    };

    function montiorAddress(address, cb){
      // Asks bitcore-node whether the input BTC address has received funds from the user
      function gotAddressInfo(data, statusCode){
        if(data.length){
          var unspentOutput = data[0];
          $interval.cancel(pollInterval);
          cb(unspentOutput);
        }
      }

      pollInterval = $interval(function(){
        console.log('montiorAddress interval called for address:', address);
        $http.get(bitcoreServiceBasePath + '/address/' + address)
          .success(gotAddressInfo);
      }, 1000);
    }

    function timeStampFile(unspentOutput, privateKey){
      // Uses the BTC received from the user to create a new transaction object
      // that includes the hash of the uploaded file
      var UnspentOutput = bitcore.Transaction.UnspentOutput;
      var Transaction = bitcore.Transaction;
      var unspent2 = UnspentOutput(unspentOutput);

      // Let's create a transaction that sends all recieved BTC to a miner
      // (no coins will go to a change address)
      var transaction2 = Transaction();
      transaction2
        .from(unspent2)
        .fee(50000);

      // Append the hash of the file to the transaction
      transaction2.addOutput(new Transaction.Output({
        script: bitcore.Script.buildDataOut(fileHash, 'hex'),
        satoshis: 0
      }));

      // Sign transaction with the original private key that generated
      // the address to which the user sent BTC
      transaction2.sign(privateKey);
      $scope.transactionId = transaction2.id;
      var serializedTransaction = transaction2.checkedSerialize();

      sendTransaction(serializedTransaction);
    }

    function sendTransaction(serializedTransaction){
      // Asks bitcore-node to broadcast the timestamped transaction
      $http.get(bitcoreServiceBasePath + '/send/' + serializedTransaction)
        .success(sentTransaction);

      function sentTransaction(){
        $scope.stampSuccess = true;
        pendingFileHashes[fileHash] = {date: new Date()};
      }
    }

    $scope.openTransactionInBrowser = function(transactionId){
      require('shell').openExternal('https://test-insight.bitpay.com/tx/' + transactionId);
    };

    // Prevent files that are dragged into the electron browser window
    // from being loaded into the browser if we are not in the preliminary
    // upload state
    window.addEventListener("dragover",function(e){
      e = e || event;
      e.preventDefault();
    },false);
    window.addEventListener("drop",function(e){
      e = e || event;
      e.preventDefault();
    },false);

}]);
