'use strict';

const HBS = require('express-hbs');
const Handlebars = require('handlebars');
const express = require('express');
const favicon = require('serve-favicon');
const utils = require('../common/utils');


module.exports = {
	instance : function (service, settings) {
		let _self = this;
		let _handlebars = Handlebars.create();
		let _hbs = HBS.create();
		_self.service = service;
		_self.settings = settings || {};
		_self.settings.extension = _self.settings.extension || '.hbs';

		let peekPath = function (paths, forFile) {
			if (paths) {
				if (paths instanceof Array) {
					return paths.iterate((pathItem) => {
						let file = utils.general.path.join(pathItem, forFile);
						if (utils.general.file.exists(file + _self.settings.extension)) {
							return file;
						}
					}) || null;
				} else {
					return utils.general.path.join(paths, forFile);
				}
			} else {
				return null;
			}
		};

		_self.retrieve = {
			container : function (forFile) {
				return _self.settings.templates ? peekPath(_self.settings.templates.containers, forFile) : null;
			},
			view      : function (forFile) {
				return _self.settings.templates ? peekPath(_self.settings.templates.views, forFile) : null;
			}
		};

		_self.compile = function (mainTemplate, data, options) {
			return new Promise(function (resolve, reject) {
				try {
					let hbs = Handlebars.create();
					let partials = {};
					let templateFile = _self.service.locate.source(mainTemplate);
					let templateFolder = utils.general.path.dirname(templateFile);
					let files = _self.service.fetch.templates(templateFolder);
					let mainContent = null;

					for (let p = 0; p < files.length; p++) {
						let file = files[p];
						if (mainTemplate.endsWith(file.filePath)) {
							mainContent = file.content;
						} else {
							partials[file.filePath.replace('.hbs', '')] = file.content;
						}
					}
					hbs.registerPartial(partials);

					if (options) {
						if (options.decorators) {
							hbs.registerDecorator(options.decorators);
						}
						if (options.helpers) {
							hbs.registerHelper(options.helpers);
						}
						if (options.partials) {
							hbs.registerPartial(options.partials);
						}
					}
					let result = hbs.compile(mainContent)(data);
					resolve(result);
				} catch (err) {
					reject(err);
				}

			});
		};

		_hbs.cacheLayout = function (layoutFile, useCache, cb) {
			let self = this;
			if (utils.general.path.extname(layoutFile) === '') {
				layoutFile += this._options.extname;
			}

			let layoutTemplates = this.cache[layoutFile];
			if (layoutTemplates) {
				return cb(null, layoutTemplates);
			}

			utils.general.fs.readFile(layoutFile, 'utf8', function (err, str) {
				if (err) {
					return cb(err);
				}

				let viewName = null;

				if (_self.settings.templates.views instanceof Array) {
					viewName = _self.settings.templates.views.iterate((viewPath) => {
						if (layoutFile.startsWith(viewPath)) {
							return layoutFile.substr(viewPath.length + 1);
						}
					}) || null;
				} else {
					if (layoutFile.startsWith(_self.settings.templates.views)) {
						viewName = layoutFile.substr(_self.settings.templates.views.length + 1);
					}
				}

				if (viewName != null) {
					let dotIndex = viewName.lastIndexOf('.');
					if (dotIndex > -1) {
						viewName = viewName.substr(0, dotIndex);
					}

					let route = _self.service.routing.retrieve.byView(viewName);
					if (route) {
						if (route.container) {
							let va = '{{!< ' + route.container + '}}';
							str = va + '\n\n' + str;
						} else if (route.parent) {
							let va = '{{!< ./../' + (typeof route.parent === 'string' ? route.parent : route.parent.name) + '}}\n\n';
							str = va + '\n\n' + str;
						}
					}
				}

				let parentLayoutFile = self.declaredLayoutFile(str, layoutFile);

				let _returnLayouts = function (layouts) {
					let currentLayout;
					layouts = layouts.slice(0);
					currentLayout = self.compile(str, layoutFile);
					layouts.push(currentLayout);
					if (useCache) {
						self.cache[layoutFile] = layouts.slice(0);
					}
					cb(null, layouts);
				};

				if (parentLayoutFile) {
					self.cacheLayout(parentLayoutFile, useCache, function (err, parentLayouts) {
						if (err) {
							return cb(err);
						}
						_returnLayouts(parentLayouts);
					});
				} else {
					_returnLayouts([]);
				}
			});
		};

		_self.include = {
			partial : function (key, value) {
				if (value instanceof Array) {
					_handlebars.registerPartial(key, value.join('\n') + '\n');
				} else {
					_handlebars.registerPartial(key, value);
				}
			},
			anxeb   : function () {
				let lines = ["<!-- Anxeb Base -->"];
				if (_self.service.routing.internal.bundle) {
					lines.push('<script src="' + utils.general.path.join(_self.service.routing.internal.bundle.path, 'core/anxeb.js') + '"></script>');
					lines.push('<script src="' + utils.general.path.join(_self.service.routing.internal.bundle.path, 'core/prototypes.js') + '"></script>');
					lines.push('<script src="' + utils.general.path.join(_self.service.routing.internal.bundle.path, 'core/utils.js') + '"></script>');
				}
				this.partial('anxeb', lines)
			}
		};

		_self.init = function () {
			if (_self.settings.templates) {
				if (_self.settings.templates && _self.settings.templates.views) {
					_self.service.express.set('views', _self.settings.templates.views);
				}

				_self.service.express.disable('view cache');

				_self.service.express.engine(_self.settings.extension, _hbs.express4({
					handlebars  : _handlebars,
					extname     : _self.settings.extension,
					partialsDir : _self.settings.templates ? _self.settings.templates.partials : null,
					layoutsDir  : _self.settings.templates ? _self.settings.templates.containers : null,
					onCompile   : function (exhbs, source, filename) {
						return exhbs.handlebars.compile(source);
					}
				}));
				_self.service.express.set('view engine', _self.settings.extension);
			}

			let staticPaths = [];
			if (_self.settings.static) {
				if (_self.settings.static instanceof Array) {
					staticPaths = _self.settings.static;
				} else {
					staticPaths = [_self.settings.static];
				}
			}

			_self.read = function (filePath) {
				for (let i = 0; i < staticPaths.length; i++) {
					let staticPath = staticPaths[i];
					let finalPath = utils.general.path.join(staticPath, filePath);

					if (utils.general.file.exists(finalPath)) {
						return utils.internal.file.read(finalPath);
					}
				}
				return null;
			};

			for (let i = 0; i < staticPaths.length; i++) {
				let staticPath = staticPaths[i];
				if (utils.general.file.exists(staticPath)) {
					_self.service.express.use(express.static(staticPath));
				} else {
					_self.service.log.exception.parameter_path_not_found.args(staticPath).throw();
				}
			}

			if (_self.settings.favicon) {
				_self.service.express.use(favicon(_self.settings.favicon));
			}
		};

		_self.init();
	}
};
