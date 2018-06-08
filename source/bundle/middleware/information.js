'use strict';

anxeb.Information = function (params) {
	var _self = this;
	_self.type = 'information';

	if (typeof(params) === "string") {
		_self.message = params;
	} else {
		_self.message = params.message;
		_self.page = params.page;
		_self.action = params.action;
		_self.color = params.color;
		_self.fill = params.fill;
		_self.icon = params.icon;
	}
};
