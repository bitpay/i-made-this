'use strict';

var gulp = require("gulp"),
    inject = require("gulp-inject"),
    sass = require("gulp-sass"),
    concat = require("gulp-concat"),
    watch = require("gulp-watch"),
    annotate = require("gulp-ng-annotate"),
    jslint = require("gulp-jslint"),
    ignore = require("gulp-ignore"),
    plumber = require("gulp-plumber"),
    bowerFiles = require("main-bower-files"),
    connect = require('electron-connect').server.create();

// index
gulp.task("index:build", function() {
    gulp.src("./app/index.html")
        .pipe(plumber())
        .pipe(inject(gulp.src(bowerFiles(), {"base": "./build/bower_components", "read": false}),
                     {"name": "bower", "relative": true}))
        .pipe(gulp.dest("./build/"));
});

gulp.task("index:watch", ["index:build"], function() {
    connect.reload();
});


// fonts
gulp.task("fonts:build", function() {
    gulp.src("./app/fonts/*")
        .pipe(plumber())
        .pipe(gulp.dest("./build/fonts"));
});


// img
gulp.task("img:build", function() {
    gulp.src("./app/img/*")
        .pipe(plumber())
        .pipe(gulp.dest("./build/img/"));
});


// sass
gulp.task("sass:build", function() {
    gulp.src("./app/sass/main.scss")
        .pipe(plumber())
        .pipe(sass())
        .pipe(gulp.dest("./build/"));
});

gulp.task("sass:watch", ["sass:build"], function() {
    connect.reload();
});


// js
gulp.task("js:build", function() {
    gulp.src("./app/**/*.js")
        .pipe(plumber())
        .pipe(jslint())
        .pipe(concat("app.js"))
        .pipe(annotate())
        .pipe(gulp.dest("./build/"));
});

gulp.task("js:watch", ["js:build"], function() {
    connect.restart();
});


// main tasks
gulp.task("build", ["index:build", "js:build", "sass:build", "img:build", "fonts:build"]);

gulp.task("watch", ["build"], function() {
    connect.start();

    gulp.watch("./app/index.html", {interval: 500}, ["index:watch"]);
    gulp.watch("./app/**/*.scss", {interval: 500}, ["sass:watch"]);
    gulp.watch("./app/**/*.js", {interval: 500}, ["js:watch"]);
});

gulp.task("default", ["watch"]);
