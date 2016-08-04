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

gulp.task("inject", function() {
    gulp.src("./app/index.html")
        .pipe(plumber())
        .pipe(inject(gulp.src(bowerFiles(), {"base": "./build/bower_components", "read": false}),
                     {"name": "bower", "relative": true}))
        .pipe(gulp.dest("./build/"));
});

gulp.task("fonts", function() {
    gulp.src("./app/fonts/*")
        .pipe(plumber())
        .pipe(gulp.dest("./build/fonts"));
});

gulp.task("sass", function() {
    gulp.src("./app/sass/main.scss")
        .pipe(plumber())
        .pipe(sass())
        .pipe(gulp.dest("./build/"));
});

gulp.task("js", function() {
    gulp.src("./app/**/*.js")
        .pipe(plumber())
        .pipe(jslint())
        .pipe(concat("app.js"))
        .pipe(annotate())
        .pipe(gulp.dest("./build/"));
});

gulp.task("img", function() {
    gulp.src("./app/img/*")
        .pipe(plumber())
        .pipe(gulp.dest("./build/img/"));
});

gulp.task('connect:restart', function() {
    // app.js
    connect.restart();
});

gulp.task('connect:reload', function() {
    // index.html
    connect.reload();
});

gulp.task("build", ["inject", "fonts", "js", "sass", "img"]);

gulp.task("watch", ["build"], function() {
    connect.start();

    gulp.watch("./app/index.html", {interval: 500}, ["inject"]);
    gulp.watch("./app/**/*.scss", {interval: 500}, ["sass"]);
    gulp.watch("./app/**/*.js", {interval: 500}, ["js"]);
});

gulp.task("default", ["watch"]);
