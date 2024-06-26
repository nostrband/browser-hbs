// heavily based on: https://raw.githubusercontent.com/TryGhost/express-hbs/main/lib/hbs.js

"use strict";

// used for hbs compiler
if (!globalThis.process) globalThis.process = {}
globalThis.process.cwd = () => "/";

import path from "path-browserify";
import handlebars from "handlebars";
import resolver from "./resolver";
import _ from "lodash";

/**
 * Regex pattern for layout directive. {{!< layout }}
 */
var layoutPattern = /{{!<\s+([A-Za-z0-9\._\-\/]+)\s*}}/;

/**
 * Constructor
 */
function BrowserHbs() {
  this.attr = 2;
  this.handlebars = handlebars.create();
  this.SafeString = this.handlebars.SafeString;
  this.Utils = this.handlebars.Utils;
  this.beautify = null;
  this.beautifyrc = null;
  this.cwd = "/";
  this.fetcher = (file, _, cb) => {
    console.log("fetch", file);
    fetch(file)
      .then((d) => d.text())
      .then((d) => { console.log("fetched", { file, d }); cb(null, d) })
      .catch((e) => cb(e));
  };
};

/**
 * Defines content for a named block declared in layout.
 *
 * @example
 *
 * {{#contentFor "pageStylesheets"}}
 * <link rel="stylesheet" href='{{{URL "css/style.css"}}}' />
 * {{/contentFor}}
 */
BrowserHbs.prototype.content = function (name, options, context) {
  var block =
    options.data.root.blockCache[name] ||
    (options.data.root.blockCache[name] = []);
  block.push(options.fn(context));
};

/**
 * Returns the layout filepath given the template filename and layout used.
 * Backward compatible with specifying layouts in locals like 'layouts/foo',
 * but if you have specified a layoutsDir you can specify layouts in locals with just the layout name.
 *
 * @param {String} filename Path to template file.
 * @param {String} layout Layout path.
 */
BrowserHbs.prototype.layoutPath = function (filename, layout) {
  var dirs, layoutPath;
  if (layout[0] === ".") {
    dirs = path.dirname(filename);
  } else if (this.layoutsDir) {
    dirs = this.layoutsDir;
  } else {
    dirs = this.viewsDir;
  }
  [].concat(dirs).forEach(function (dir) {
    if (!layoutPath) {
      layoutPath = path.resolve(dir, layout);
    }
  });
  return layoutPath;
};

/**
 * Find the path of the declared layout in `str`, if any
 *
 * @param  {String} str The template string to parse
 * @param {String} filename Path to template
 * @returns {String|undefined} Returns the path to layout.
 */
BrowserHbs.prototype.declaredLayoutFile = function (str, filename) {
  var matches = str.match(layoutPattern);
  console.log("declaredLayoutFile", { str, filename, matches })
  if (matches) {
    var layout = matches[1];
    // behave like `require`, if '.' then relative, else look in
    // usual location (layoutsDir)
    if (this.layoutsDir && layout[0] !== ".") {
      layout = path.resolve(this.layoutsDir, layout);
    }
    return path.resolve(path.dirname(filename), layout);
  }
};

/**
 * Compiles a layout file.
 *
 * The function checks whether the layout file declares a parent layout.
 * If it does, the parent layout is loaded recursively and checked as well
 * for a parent layout, and so on, until the top layout is reached.
 * All layouts are then returned as a stack to the caller via the callback.
 *
 * @param {String}      layoutFile  The path to the layout file to compile
 * @param {Boolean}     useCache    Cache the compiled layout?
 * @param {Function}    cb          Callback called with layouts stack
 */
BrowserHbs.prototype.cacheLayout = function (layoutFile, useCache, cb) {
  var self = this;

  if (this.restrictLayoutsTo) {
    if (!layoutFile.startsWith(this.restrictLayoutsTo)) {
      var err = new Error(
        "Cannot read " +
          layoutFile +
          " it does not reside in " +
          this.restrictLayoutsTo
      );
      return cb(err, null);
    }
  }

  // assume hbs extension
  if (path.extname(layoutFile) === "") layoutFile += this._options.extname;
  console.log("cacheLayout", layoutFile);

  // path is relative in directive, make it absolute
  var layoutTemplates = this.cache[layoutFile];
  if (layoutTemplates) return cb(null, layoutTemplates);

  this.fetcher(layoutFile, "utf8", function (err, str) {
    if (err) return cb(err);

    //  File path of eventual declared parent layout
    var parentLayoutFile = self.declaredLayoutFile(str, layoutFile);

    // This function returns the current layout stack to the caller
    var _returnLayouts = function (layouts) {
      var currentLayout;
      layouts = layouts.slice(0);
      currentLayout = self.compile(str, layoutFile);
      layouts.push(currentLayout);
      if (useCache) {
        self.cache[layoutFile] = layouts.slice(0);
      }
      cb(null, layouts);
    };

    if (parentLayoutFile) {
      // Recursively compile/cache parent layouts
      console.log("parentLayoutFile", { parentLayoutFile, layoutFile });
      self.cacheLayout(
        parentLayoutFile,
        useCache,
        function (err, parentLayouts) {
          if (err) return cb(err);
          _returnLayouts(parentLayouts);
        }
      );
    } else {
      // No parent layout: return current layout with an empty stack
      _returnLayouts([]);
    }
  });
};

/**
 * Cache partial templates found under directories configure in partialsDir.
 */
BrowserHbs.prototype.cachePartials = async function (cb) {
  var self = this;

  try {
    for (const dir in this.partialsDir) {
      for (const partial of this.partialsDir[dir]) {
        const fullPath = dir + partial;
        var source = await new Promise((ok, err) => {
          this.fetcher(fullPath, "utf8", (e, d) => {
            if (e) err(e);
            else ok(d);
          });
        });
        var dirname = path.dirname(partial);
        dirname = dirname === "." ? "" : dirname + "/";

        var name = dirname + path.basename(partial, self._options.extname);
        console.log("registerPartial", name, partial);
        self.registerPartial(name, source, partial);
      }
    }

    this.isPartialCachingComplete = true;
    if (cb) cb(null, true);
  } catch (e) {
    if (cb) cb(e);
  }
};

/**
 * Initialize the template engine.
 *
 * @param {Object} options = {
 *   handlebars: "override handlebars",
 *   defaultLayout: "path to default layout",
 *   partials: "array of absolute paths to partials",
 *   layoutsDir: "absolute path to the layouts",
 *   extname: "extension to use, default .hbs",
 *   contentHelperName: "contentFor",
 *   blockHelperName: "block",
 *   beautify: "{Boolean} whether to pretty print HTML",
 *   onCompile: function(self, source, filename) {
 *       return self.handlebars.compile(source);
 *   }
 * }
 */
BrowserHbs.prototype.init = function(options) {
  var self = this;

  // Set defaults
  if (!options) options = {};
  if (!options.extname) options.extname = ".hbs";
  if (!options.contentHelperName) options.contentHelperName = "contentFor";
  if (!options.blockHelperName) options.blockHelperName = "block";
  if (!options.templateOptions) options.templateOptions = {};
  if (options.handlebars) this.handlebars = options.handlebars;
  if (options.onCompile) this.onCompile = options.onCompile;

  this._options = options;
  if (this._options.handlebars) this.handlebars = this._options.handlebars;

  if (options.i18n) {
    var i18n = options.i18n;
    this.handlebars.registerHelper("__", function () {
      var args = Array.prototype.slice.call(arguments);
      var options = args.pop();
      return i18n.__.apply(options.data.root, args);
    });
    this.handlebars.registerHelper("__n", function () {
      var args = Array.prototype.slice.call(arguments);
      var options = args.pop();
      return i18n.__n.apply(options.data.root, args);
    });
  }

  this.handlebars.registerHelper(
    this._options.blockHelperName,
    function (name, options) {
      var val = options.data.root.blockCache[name];
      if (val === undefined && typeof options.fn === "function") {
        val = options.fn(this);
      }
      if (Array.isArray(val)) {
        val = val.join("\n");
      }
      return val;
    }
  );

  // Pass 'this' as context of helper function to don't lose context call of helpers.
  this.handlebars.registerHelper(
    this._options.contentHelperName,
    function (name, options) {
      return self.content(name, options, this);
    }
  );

  // Absolute paths to partial templates.
  this.partialsDir = this._options.partialsDir;

  // Absolute path to the layouts directory
  this.layoutsDir = this._options.layoutsDir;

  this.restrictLayoutsTo = this._options.restrictLayoutsTo;

  // express passes this through ___express func, gulp pass in an option
  this.viewsDir = null;
  this.viewsDirOpt = this._options.viewsDir;

  // Cache for templates, express 3.x doesn't do this for us
  this.cache = {};

  // Holds the default compiled layout if specified in options configuration.
  this.defaultLayoutTemplates = null;

  // Keep track of if partials have been cached already or not.
  this.isPartialCachingComplete = false;
};

/**
 * Tries to load the default layout.
 *
 * @param {Boolean} useCache Whether to cache.
 */
BrowserHbs.prototype.loadDefaultLayout = function (useCache, cb) {
  var self = this;
  if (!this._options.defaultLayout) return cb();
  if (useCache && this.defaultLayoutTemplates)
    return cb(null, this.defaultLayoutTemplates);

  this.cacheLayout(
    this._options.defaultLayout,
    useCache,
    function (err, templates) {
      if (err) return cb(err);
      self.defaultLayoutTemplates = templates.slice(0);
      return cb(null, templates);
    }
  );
};

/**
 * Expose useful methods.
 */
BrowserHbs.prototype.registerHelper = function (name, fn) {
  this.handlebars.registerHelper(name, fn);
};

/**
 * Registers a partial.
 *
 * @param {String} name The name of the partial as used in a template.
 * @param {String} source String source of the partial.
 */
BrowserHbs.prototype.registerPartial = function (name, source, filename) {
  this.handlebars.registerPartial(name, this.compile(source, filename));
};

/**
 * Compiles a string.
 *
 * @param {String} source The source to compile.
 * @param {String} filename The path used to embed into __filename for errors.
 */
BrowserHbs.prototype.compile = function (source, filename) {
  // Handlebars has a bug with comment only partial causes errors. This must
  // be a string so the block below can add a space.
  if (typeof source !== "string") {
    throw new Error(
      "registerPartial must be a string for empty comment workaround"
    );
  }
  if (source.indexOf("}}") === source.length - 2) {
    source += " ";
  }

  var compiled;
  if (this.onCompile) {
    compiled = this.onCompile(this, source, filename);
  } else {
    compiled = this.handlebars.compile(source);
  }

  if (filename) {
    if (Array.isArray(this.viewsDir) && this.viewsDir.length > 0) {
      compiled.__filename = path
        .relative(this.cwd, filename)
        .replace(path.sep, "/");
    } else {
      compiled.__filename = path
        .relative(this.viewsDir || "", filename)
        .replace(path.sep, "/");
    }
  }
  console.log("compiled", {
    source,
    filename,
    compiled,
    onCompile: this.onCompile,
  });
  return compiled;
};

/**
 * Registers an asynchronous helper.
 *
 * @param {String} name The name of the partial as used in a template.
 * @param {String} fn The `function(options, cb)`
 */
BrowserHbs.prototype.registerAsyncHelper = function (name, fn) {
  this.handlebars.registerHelper(name, function (context, options) {
    var resolverCache =
      this.resolverCache ||
      _.get(context, "data.root.resolverCache") ||
      _.get(options, "data.root.resolverCache");
    if (!resolverCache) {
      throw new Error(
        "Could not find resolver cache in async helper " + name + "."
      );
    }
    if (options && fn.length > 2) {
      var resolveFunc = function (arr, cb) {
        return fn.call(this, arr[0], arr[1], cb);
      };

      return resolver.resolve(resolverCache, resolveFunc.bind(this), [
        context,
        options,
      ]);
    }
    return resolver.resolve(resolverCache, fn.bind(this), context);
  });
};

BrowserHbs.prototype.getTemplateOptions = function () {
  return this._options.templateOptions;
};

BrowserHbs.prototype.updateTemplateOptions = function (templateOptions) {
  this._options.templateOptions = templateOptions;
};

BrowserHbs.prototype.getLocalTemplateOptions = function (locals) {
  return locals._templateOptions || {};
};

BrowserHbs.prototype.updateLocalTemplateOptions = function (
  locals,
  localTemplateOptions
) {
  return (locals._templateOptions = localTemplateOptions);
};

/**
 * Creates a new instance of ExpressHbs.
 */
BrowserHbs.prototype.create = function () {
  return new BrowserHbs();
};

/**
 * Renderer
 *
 * @param {String} filename Full path to template.
 * @param {Object} options Is the context or locals for templates. {
 *  {Object} settings - subset of Express settings, `settings.views` is
 *                      the views directory
 * }
 * @param {Function} cb The callback expecting the rendered template as a string.
 *
 * @example
 *
 * Example options from express
 *
 *      {
 *        settings: {
 *           'x-powered-by': true,
 *           env: 'production',
 *           views: '/home/coder/barc/code/express-hbs/example/views',
 *           'jsonp callback name': 'callback',
 *           'view cache': true,
 *           'view engine': 'hbs'
 *         },
 *         cache: true,
 *
 *         // the rest are app-defined locals
 *         title: 'My favorite veggies',
 *         layout: 'layout/veggie'
 *       }
 */
BrowserHbs.prototype.render = function(filename, source, options, cb) {
  // support running as a gulp/grunt filter outside of express
  if (arguments.length === 3) {
    cb = options;
    options = source;
    source = null;
  }

  if (path.extname(filename) === "") filename += this._options.extname;

  console.log("hbs render", { filename, source, options, cb });

  options.blockCache = {};
  options.resolverCache = {};

  this.viewsDir = options.settings?.views || this.viewsDirOpt;
  var self = this;

  /**
   * Allow a layout to be declared as a handlebars comment to remain spec
   * compatible with handlebars.
   *
   * Valid directives
   *
   *  {{!< foo}}                      # foo.hbs in same directory as template
   *  {{!< ../layouts/default}}       # default.hbs in parent layout directory
   *  {{!< ../layouts/default.html}}  # default.html in parent layout directory
   */
  function parseLayout(str, filename, cb) {
    var layoutFile = self.declaredLayoutFile(str, filename);
    console.log("parseLayout", { layoutFile, str, filename });
    if (layoutFile) {
      self.cacheLayout(layoutFile, options.cache, cb);
    } else {
      cb(null, null);
    }
  }

  /**
   * Renders `template` with given `locals` and calls `cb` with the
   * resulting HTML string.
   *
   * @param template
   * @param locals
   * @param cb
   */
  function renderTemplate(template, locals, cb) {
    var res;

    console.log("renderTemplate", { template, locals });

    try {
      var localTemplateOptions = self.getLocalTemplateOptions(locals);
      var localsClone = _.extend({}, locals);
      self.updateLocalTemplateOptions(localsClone, undefined);
      res = template(
        localsClone,
        _.merge({}, self._options.templateOptions, localTemplateOptions)
      );
    } catch (err) {
      if (err.message) {
        err.message = "[" + template.__filename + "] " + err.message;
      } else if (typeof err === "string") {
        return cb("[" + template.__filename + "] " + err, null);
      }
      return cb(err, null);
    }
    console.log("rendered", { template, locals, res });
    cb(null, res);
  }

  /**
   * Renders `template` with an optional set of nested `layoutTemplates` using
   * data in `locals`.
   */
  function render(template, locals, layoutTemplates, cb) {
    if (!layoutTemplates) layoutTemplates = [];

    console.log("render", { template, locals, layoutTemplates });

    // We'll render templates from bottom to top of the stack, each template
    // being passed the rendered string of the previous ones as `body`
    var i = layoutTemplates.length - 1;

    var _stackRenderer = function (err, htmlStr) {
      if (err) return cb(err);

      console.log("render done", {
        i,
        template,
        locals,
        layoutTemplates,
        htmlStr,
      });
      if (i >= 0) {
        locals.body = htmlStr;
        renderTemplate(layoutTemplates[i--], locals, _stackRenderer);
      } else {
        cb(null, htmlStr);
      }
    };

    // Start the rendering with the innermost page template
    renderTemplate(template, locals, _stackRenderer);
  }

  /**
   * Lazy loads js-beautify, which should not be used in production env.
   */
  function loadBeautify() {
    if (!self.beautify) {
      self.beautify = (htmlStr) => htmlStr; // temporary stub
      // self.beautify = require('js-beautify').html;
      // var rc = path.join(getCWD(), '.jsbeautifyrc');
      // if (fs.existsSync(rc)) {
      //   self.beautifyrc = JSON.parse(fs.readFileSync(rc, 'utf8'));
      // }
    }
  }

  /**
   * Gets the source and compiled template for filename either from the cache
   * or compiling it on the fly.
   */
  function getSourceTemplate(cb) {
    if (options.cache) {
      var info = self.cache[filename];
      if (info) {
        return cb(null, info.source, info.template);
      }
    }

    console.log("getSourceTemplate", filename);
    self.fetcher(filename, "utf8", function (err, source) {
      if (err) return cb(err);

      var template = self.compile(source, filename);
      if (options.cache) {
        self.cache[filename] = {
          source: source,
          template: template,
        };
      }
      return cb(null, source, template);
    });
  }

  /**
   * Compiles a file into a template and a layoutTemplate, then renders it above.
   */
  function compileFile(locals, cb) {
    getSourceTemplate(function (err, source, template) {
      if (err) return cb(err);

      // Try to get the layout
      parseLayout(source, filename, function (err, layoutTemplates) {
        if (err) return cb(err);

        console.log("parseLayout done", { source, filename, layoutTemplates });

        function renderIt(layoutTemplates) {
          if (self._options.beautify) {
            return render(
              template,
              locals,
              layoutTemplates,
              function (err, html) {
                if (err) return cb(err);
                loadBeautify();
                return cb(null, self.beautify(html, self.beautifyrc));
              }
            );
          }
          return render(template, locals, layoutTemplates, cb);
        }

        // Determine which layout to use

        if (typeof options.layout !== "undefined" && !options.layout) {
          // If options.layout is falsy, behave as if no layout should be used - suppress defaults
          renderIt(null);
        } else if (layoutTemplates) {
          // 1. Layout specified in template
          renderIt(layoutTemplates);
        } else if (typeof options.layout !== "undefined" && options.layout) {
          // 2. Layout specified by options from render
          var layoutFile = self.layoutPath(filename, options.layout);
          self.cacheLayout(
            layoutFile,
            options.cache,
            function (err, layoutTemplates) {
              if (err) return cb(err);
              renderIt(layoutTemplates);
            }
          );
        } else if (self.defaultLayoutTemplates) {
          // 3. Default layout specified when middleware was configured.
          console.log("renderIt default", self.defaultLayoutTemplates)
          renderIt(self.defaultLayoutTemplates);
        } else {
          // render without a template
          renderIt(null);
        }
      });
    });
  }

  function replaceValue(values, text) {
    if (typeof text === "string") {
      Object.keys(values).forEach(function (id) {
        text = text.replace(id, function () {
          return values[id];
        });
        text = text.replace(self.Utils.escapeExpression(id), function () {
          return self.Utils.escapeExpression(values[id]);
        });
      });
    }
    return text;
  }

  // Handles waiting for async helpers
  function handleAsync(err, res) {
    if (err) return cb(err);
    resolver.done(options.resolverCache, function (err, values) {
      if (err) return cb(err);
      Object.keys(values).forEach(function (key) {
        values[key] = replaceValue(values, values[key]);
      });
      res = replaceValue(values, res);
      if (resolver.hasResolvers(res)) {
        return handleAsync(null, res);
      }
      cb(null, res);
    });
  }

  // kick it off by loading default template (if any)
  this.loadDefaultLayout(options.cache, function (err) {
    if (err) return cb(err);

    // Force reloading of all partials if caching is not used. Inefficient but there
    // is no loading partial event.
    if (self.partialsDir && (!options.cache || !self.isPartialCachingComplete)) {
      return self.cachePartials(function (err) {
        if (err) return cb(err);
        return compileFile(options, handleAsync);
      });
    }

    return compileFile(options, handleAsync);
  });
};

export default BrowserHbs;