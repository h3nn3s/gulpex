const defaults = {
  projectRoot: '.',
  documentRoot: './html',
  assetDirectory: './html/assets',
  nodeModules: './node_modules',
  cssDirectory: './html/css',
  scriptsDir: './html/js',
  bundles: {},
  assets: [],
  includePaths: [],
};

const styleFilter = objects => key => objects[key].type === 'style';
const scriptFilter = objects => key => objects[key].type === 'script';
const objectFilter = (objects, typeFilter) => {
  return Object.keys(objects).
      filter(typeFilter(objects)).
      reduce((obj, key) => {
        obj[key] = JSON.parse(JSON.stringify(objects[key]));
        return obj;
      }, {});
};

module.exports = function(exports, config) {
  config = Object.assign(defaults, config);
  config.styles = objectFilter(config.bundles, styleFilter);
  config.bundles = objectFilter(config.bundles, scriptFilter);

  const fs = require('fs');
  const gulp = require('gulp');
  const sass = require('gulp-sass');
  const sourcemap = require('gulp-sourcemaps');
  const postcss = require('gulp-postcss');
  const plumber = require('gulp-plumber');
  const autoprefixer = require('autoprefixer');
  const cssnano = require('cssnano');
  const concat = require('gulp-concat');
  const rename = require('gulp-rename');
  const uglify = require('gulp-uglify-es').default;
  const livereload = require('gulp-livereload');
  const gulpif = require('gulp-if');

  const gulpext = function (config, gulp, exp) {
    try {
      let includePaths = fs.readdirSync('./gulp/extensions/autoload');
      includePaths = includePaths.map(v => 'autoload/' + v);
      config.extensions.splice(0, 0, ...includePaths);
      console.log(config.extensions);
    } catch (e) {
    }

    for (let extensionFile of config.extensions) {
      // Prepend relative path
      extensionFile = './extensions/' + extensionFile;

      // Remove .js suffix if applicable
      if (extensionFile.substr(-3, 3).toLowerCase() === '.js') {
        extensionFile = extensionFile.substr(0, extensionFile.length - 3);
      }

      // Load extension
      try {
        let extension = require(extensionFile);
        console.log('[GulpEx] Loading extension: ' + extensionFile);
        extension.default(exp, gulp);
      } catch (error) {
        console.error('[GulpEx] Failed to load extension ' + extensionFile);
        console.error(error);
      }
    }
  };

  const end = function(message) {
    console.log(message);
    this.emit('end');
  };
  const err = function(error) {
    console.error(error);
    this.emit('end');
  };

  function init(done) {
    function copyPublicAssets() {
      let assets = config.assets;

      if (assets.length === 0) {
        return Promise.resolve();
      }

      let resolver = Promise.resolve();
      for (let asset in assets) {
        if (!assets.hasOwnProperty(asset)) {
          continue;
        }

        asset = assets[asset];
        if (typeof asset === 'string') {
          asset = {src: asset, dest: config.assetDirectory};
        } else if (typeof asset === 'object' &&
            asset.hasOwnProperty('length')) {
          if (asset.length < 2) {
            asset[1] = config.assetDirectory;
          }
          asset = {src: asset[0], dest: asset[1]};
        }

        if (typeof asset.src === 'undefined') {
          continue;
        }

        if (typeof asset.dest === 'undefined') {
          asset.dest = config.assetDirectory;
        }

        resolver = resolver.then(
            new Promise((resolve, reject) => {
              gulp.src(asset.src).
                  on('error', reject).
                  pipe(gulp.dest(asset.dest)).
                  on('error', reject).
                  on('end', resolve);
            }),
        );
      }

      return resolver.catch(() => {
        console.err('Error while copying public assets. Check paths!');
      });
    }

    Promise.resolve().then(copyPublicAssets).catch(error => {
      console.warn(error.message);
    }).finally(() => {
      done();
    });
  }

  function createBundle(bundle, deploy) {
    return new Promise((resolve) => {

      bundle.path = typeof bundle.path !== 'string' ?
          config.scriptsDir :
          bundle.path;

      bundle.minify = typeof bundle.minify === 'boolean' ?
          bundle.minify :
          true;

      gulp.src(bundle.files).
          pipe(gulpif(!deploy, sourcemap.init())).
          on('error', err).
          pipe(concat(bundle.name, {newLine: ';\n'})).
          on('error', err).
          pipe(gulpif(deploy && bundle.minify, uglify())).
          on('error', err).
          pipe(gulpif(deploy && bundle.minify, rename({suffix: '.min'}))).
          on('error', end).
          pipe(gulpif(!deploy, sourcemap.write('.'))).
          on('error', err).
          pipe(gulp.dest(bundle.path)).
          on('error', err).
          on('end', resolve);
    });
  }

  function buildJs(deploy, bundleKey) {
    deploy = !!deploy;

    let single = typeof bundleKey === 'string';
    single = single && bundleKey.trim().length > 0;
    if (single) {
      bundleKey = bundleKey.trim().toLowerCase();
    }

    return function(done) {
      let promises = [];
      for (let key in config.bundles) {
        if (!config.bundles.hasOwnProperty(key)) continue;
        if (typeof key !== 'string') continue;
        let bundle = config.bundles[key];

        if (!bundle.hasOwnProperty('name')) continue;
        if (typeof bundle.name !== 'string') continue;
        if (typeof bundle.files !== 'object') continue;
        if (bundle.files.length < 1) continue;

        if (!single || key.trim().toLowerCase() === bundleKey) {
          promises.push(createBundle(bundle, deploy));
        }
      }

      Promise.all(promises).then(() => done()).catch(e => {
        console.error(e);
        done();
      });
    };
  }

  function createStyle(style, deploy) {
    return new Promise((resolve) => {
      style.path = typeof style.path !== 'string' ?
          config.cssDirectory :
          style.path;

      style.minify = typeof style.minify === 'boolean' ?
          style.minify :
          true;

      gulp.src(style.files).
          pipe(plumber()).
          on('error', err).
          pipe(gulpif(!deploy, sourcemap.init())).
          on('error', err).
          pipe(sass({
            outputStyle: 'nested',
            includePaths: config.includePaths,
          })).
          on('error', err).
          pipe(gulpif(deploy, postcss([autoprefixer()]))).
          on('error', end).
          pipe(gulpif(deploy && style.minify, postcss([cssnano()]))).
          on('error', end).
          pipe(gulpif(deploy && style.minify, rename({suffix: '.min'}))).
          on('error', end).
          pipe(gulpif(!deploy, sourcemap.write('.'))).
          on('error', err).
          pipe(gulp.dest(style.path)).
          on('error', err).
          on('end', resolve);
    });
  }

  function buildCss(deploy, styleKey) {
    deploy = !!deploy;

    let single = typeof styleKey === 'string';
    single = single && styleKey.trim().length > 0;
    if (single) {
      styleKey = styleKey.trim().toLowerCase();
    }

    return function(done) {
      let promises = [];
      for (let key in config.styles) {
        if (!config.styles.hasOwnProperty(key)) continue;
        if (typeof key !== 'string') continue;
        let style = config.styles[key];

        if (typeof style.files !== 'object') continue;
        if (style.files.length < 1) continue;

        if (!single || key.trim().toLowerCase() === styleKey) {
          promises.push(createStyle(style, deploy));
        }
      }

      Promise.all(promises).then(() => done()).catch(e => {
        console.error(e);
        done();
      });
    };
  }

  function reload(style) {
    // Define filte rule for distinct items
    const distinct = (value, index, self) => {
      return self.indexOf(value) === index;
    };

    // Proxy style into
    let styles;
    if (typeof style === 'object') {
      styles = [style];
    } else {
      styles = Object.values(config.styles);
    }

    // Build CSS-Paths from Style-Files & Output Path
    let reloadPaths = styles.map(o => {
      return (!o.path ?
          config.cssDirectory :
          o.path) + '/**/*.css';
    }).flat().filter(distinct);

    // Return Closure
    return function() {
      return gulp.src(reloadPaths).pipe(livereload());
    };
  }

  function watch() {
    livereload.listen();

    const watcherOpts = {atomic: true, usePolling: true, alwaysStat: true};

    // Initialize Stylesheet-Watchers
    for (let key in config.styles) {
      if (!config.styles.hasOwnProperty(key)) continue;
      if (typeof key !== 'string') continue;
      let style = config.styles[key];

      if (typeof style.watch !== 'object') {
        if (typeof style.watch === 'undefined') {
          style.watch = [];
        } else {
          style.watch = !!style.watch;
        }
      }

      if (!!style.watch) {
        if (typeof style.watch !== 'object') {
          style.watch = [];
        }

        let watchPaths = style.watch.slice();
        watchPaths.splice(0, 0, ...style.files);

        gulp.watch(
            watchPaths,
            watcherOpts,
            gulp.series(
                buildCss(false, key),
                reload(style),
            ),
        );
      }
    }

    // Initialize JS-Bundle Watchers
    for (let key in config.bundles) {
      if (!config.bundles.hasOwnProperty(key)) continue;
      if (typeof key !== 'string') continue;
      let bundle = config.bundles[key];

      if (!bundle.hasOwnProperty('name')) continue;
      if (typeof bundle.name !== 'string') continue;

      if (typeof bundle.watch !== 'boolean') {
        bundle.watch = true;
      }

      if (bundle.watch) {
        gulp.watch(
            bundle.files,
            watcherOpts,
            gulp.parallel(
                buildJs(false, key),
            ),
        );
      }
    }
  }

// Initialization Tasks
  exports['init'] = init;

// Converting Tasks
  exports['convert-js'] = buildJs(false);
  exports['convert-css'] = buildCss(false);
  exports['convert'] = gulp.parallel(createBundle, exports['convert-css']);

// Deployment Tasks
  const deployJs = gulp.parallel(exports['convert-js'], buildJs(true));
  const deployCss = gulp.parallel(exports['convert-css'], buildCss(true));
  exports['deploy-js'] = gulp.series(init, deployJs);
  exports['deploy-css'] = gulp.series(init, deployCss);
  exports['deploy'] = gulp.series(init, gulp.parallel(deployJs, deployCss));

// Watcher Tasks
  exports['watch'] = gulp.series(exports['deploy'], watch);
  exports['default'] = exports['watch'];

// Finish Initialisation
  try {
    console.log('[GulpEx] Loading optional modules...');
    gulpext(config, gulp, exports);
    console.log('[GulpEx] Finished loading optional modules.');
  } catch (e) {
    console.warn('[GulpEx] Proceeding without optional modules.');
  }
};