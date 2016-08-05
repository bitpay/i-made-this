'use strict';

var app = require('app'),                         // app controls application life cycle.
    BrowserWindow = require('browser-window'),    // BrowserWindow controls native browser window.
    connect = require('electron-connect').client; // connect controls the development code live reload.
                                                  // TODO: Remove this line before building your final package.

// Crashes will be reported to the server for debugging.
require('crash-reporter').start();

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
var mainWindow = null;

// Quit when all windows are closed.
app.on('window-all-closed', function() {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ready will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', function() {
    // Create the browser window.
    mainWindow = new BrowserWindow({width: 725, height: 680, resizable: false});

    // Load the index.html of the app. The apps static assets should
    // be parallel to this location.
    mainWindow.loadUrl('file://' + __dirname + '/build/index.html');

    // Comment this out to not show the development tools.
    // mainWindow.openDevTools();

    // Dereference the window object. Usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow.on('closed', function() {
        mainWindow = null;
    });

    // Connect to the gulp live reload server.
    // TODO: Remove this line before building your final package.
    connect.create(mainWindow);
});
