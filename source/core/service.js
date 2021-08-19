'use strict';

const express = require('express');

const utils = require('../common/utils');
const Log = require('../middleware/log').instance;
const Routing = require('../middleware/routing').instance;
const Socket = require('../middleware/socket').instance;
const Scheduler = require('../middleware/scheduler').instance;
const Storage = require('../middleware/storage').instance;
const Configuration = require('../middleware/configuration').instance;
const Security = require('../middleware/security').instance;
const Renderer = require('../middleware/renderer').instance;
const Locator = require('../common/locator').instance;

module.exports = function (server, params) {
	let _self = this;

	_self.log = new Log();
	_self.log.require({
		from  : params,
		items : [
			'domain',
			'name',
			'key'
		]
	}, 'service');

	utils.internal.parameters.process.service(params, server);
	_self.log.init(params.settings.log);

	_self.parameters = {
		fill : function (params, prop) {
			return utils.internal.parameters.process.custom(params, prop, _self);
		}
	};

	_self.fetch = {
		modules   : function (modulesPath, caller, options) {
			let ownerDesc = caller ? (_self.key + ' ' + caller) : 'internal  ' + _self.key + ' usage';

			try {
				return utils.internal.modules.list(modulesPath, options || {
					subfolders : true,
					endsWith   : '.js'
				});
			} catch (err) {
				if (err.code === 4) {
					_self.log.exception.modules_path_not_found.args(err.path, ownerDesc, err).throw();
				} else {
					_self.log.exception.modules_load_exception.args(ownerDesc, err).throw();
				}
			}
		},
		files     : function (filesPath, options) {
			if (filesPath) {
				let getFiles = function (filesPath, options) {
					let result = [];
					if (!utils.general.file.exists(filesPath)) {
						_self.log.exception.parameter_file_not_found.args(filesPath).throw();
					} else {
						let flist = utils.general.file.list(filesPath, options || {
							subfolders : true,
							endsWith   : '.js',
							content    : false
						});
						for (let f = 0; f < flist.length; f++) {
							let fileName = flist[f];
							let fullPath = utils.general.path.join(filesPath, fileName);
							result.push({
								filePath : fileName,
								rootPath : filesPath,
								fullPath : fullPath,
								content  : options && options.content === true ? utils.general.file.read(fullPath, 'utf8') : undefined
							});
						}
					}
					return result;
				};

				let result = [];
				if (filesPath instanceof Array) {
					for (let i = 0; i < filesPath.length; i++) {
						let fpath = filesPath[i];
						result = result.concat(getFiles(fpath, options));
					}
				} else {
					result = getFiles(filesPath, options);
				}

				return result;
			} else {
				_self.log.exception.missing_parameter.args('filesPath', _self.key + '.fetch.files').throw();
			}
		},
		templates : function (templatesPath, options) {
			options = options || {};
			options.content = options.content || true;
			options.subfolders = options.subfolders || true;
			options.endsWith = options.endsWith || '.hbs';

			return this.files(templatesPath, options);
		}
	};

	_self.initialized = false;
	_self.settings = params.settings;
	_self.server = server;
	_self.name = params.name;
	_self.version = params.version;
	_self.key = params.key;
	_self.domain = params.domain;
	_self.active = params.active;
	_self.initialize = params.initialize;
	_self.express = express();
	_self.application = {};
	_self.extensions = params.extensions;
	_self.client = _self.settings ? _self.settings.client : null;
	_self.locate = new Locator(_self.server.settings.root, _self.server.structure, {
		storage : _self.settings.storage != null ? _self.settings.storage.sub_folder : null
	});

	_self.security = new Security(_self, _self.settings.security);
	_self.storage = new Storage(_self, _self.settings.storage);
	_self.configuration = new Configuration(_self, _self.settings.configuration, params.configuration);
	_self.renderer = new Renderer(_self, _self.settings.renderer);
	_self.scheduler = new Scheduler(_self, _self.settings.scheduler);
	_self.socket = new Socket(_self, _self.settings.socket);
	_self.routing = new Routing(_self, _self.settings.routing);

	_self.start = function () {
		_self.log.break();
		_self.configuration.refresh();
		_self.renderer.include.anxeb();
		
		if (_self.routing.internal.bundle) {
			_self.routing.internal.bundle.include.anxeb();
		}

		return new Promise(function (resolve, reject) {
			let tries = _self.settings.tries !== undefined ? _self.settings.tries : 5;
			let beginListening = function () {
				return new Promise(function (resolve, reject) {
					_self.log.debug.service_starting.args(_self.key, _self.socket.host, _self.socket.port).print();
					_self.initialized = false;
					_self.socket.listen().then(function () {
						try {
							_self.scheduler.start();
							_self.initialized = true;
							_self.security.check();
							resolve();
						} catch (err) {
							reject(err);
						}
					}).catch(function (err) {
						tries--;
						if (tries > 0) {
							setTimeout(function () {
								beginListening().then(resolve).catch(reject);
							}, 2000);
						} else {
							reject();
						}
					});
				});
			};

			beginListening().then(function () {
				_self.log.debug.service_initialized.args(_self.key).print();
				if (_self.extensions) {
					let starters = [];
					for (let key in _self.extensions) {
						let settings = _self.extensions[key];
						let extension = _self.server.extensions[key];

						if (extension && extension.instance && extension.instance.start) {
							starters.push(extension.instance.start(_self, settings));
						}
					}

					if (starters.length) {
						Promise.all(starters).then(function () {
							_self.log.reload();
							resolve();
						}).catch(function (err) {
							_self.log.exception.extension_startup_failed.args(err.key || 'unknown', err).print();
							reject();
						});
					} else {
						resolve();
					}
				} else {
					resolve();
				}
				if (_self.initialize) {
					_self.initialize(_self, _self.application);
				}
			}).catch(reject);
		});
	};
};