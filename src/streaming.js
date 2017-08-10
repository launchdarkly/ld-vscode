import * as EventSource from 'eventsource';

var noop = function() {};

function StreamProcessor(sdk_key, config, requestor) {
	var store = config.feature_store;
	var es;
	var processor = {
		start: function(fn) {
			var cb = fn || noop;
			es = new EventSource(config.stream_uri + '/flags', {
				headers: { Authorization: sdk_key },
			});

			es.onerror = function(err) {
				cb(err);
			};

			es.addEventListener('put', function(e) {
				if (e && e.data) {
					var flags = JSON.parse(e.data);
					store.init(flags, function() {
						cb();
					});
				} else {
					cb(new Error('[LaunchDarkly] Unexpected payload from event stream'));
				}
			});

			es.addEventListener('patch', function(e) {
				if (e && e.data) {
					var patch = JSON.parse(e.data);
					store.upsert(patch.data.key, patch.data);
				}
			});

			es.addEventListener('delete', function(e) {
				if (e && e.data) {
					var data = JSON.parse(e.data),
						key =
							data.path.charAt(0) === '/' ? data.path.substring(1) : data.path, // trim leading '/'
						version = data.version;

					store.delete(key, version);
				}
			});

			es.addEventListener('indirect/put', function(e) {
				requestor.request_all_flags(function(err, flags) {
					if (err) {
						cb(err);
					} else {
						store.init(flags, function() {
							cb();
						});
					}
				});
			});

			es.addEventListener('indirect/patch', function(e) {
				if (e && e.data) {
					var key = e.data.charAt(0) === '/' ? e.data.substring(1) : e.data;
					requestor.request_flag(key, function(err, flag) {
						if (!err) {
							store.upsert(key, flag);
						}
					});
				}
			});
		},
		stop: function() {
			if (es) {
				es.close();
			}
		},
		close: function() {
			this.stop();
		},
	};

	return processor;
}

module.exports = StreamProcessor;
