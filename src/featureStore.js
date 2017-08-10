var noop = function() {};

function InMemoryFeatureStore() {
	var store = {
		flags: {},
		get: function(key, cb) {
			cb = cb || noop;

			if (this.flags.hasOwnProperty(key)) {
				var flag = this.flags[key];

				if (!flag || flag.deleted) {
					cb(null);
				} else {
					cb(clone(flag));
				}
			} else {
				cb(null);
			}
		},
		all: function(cb) {
			cb = cb || noop;
			var results = {};

			for (var key in this.flags) {
				if (this.flags.hasOwnProperty(key)) {
					var flag = this.flags[key];
					if (flag && !flag.deleted) {
						results[key] = clone(flag);
					}
				}
			}

			cb(results);
		},
		init: function(flags, cb) {
			cb = cb || noop;
			this.flags = flags;
			this.init_called = true;
			cb();
		},
		delete: function(key, version, cb) {
			cb = cb || noop;

			if (this.flags.hasOwnProperty(key)) {
				var old = this.flags[key];
				if (old && old.version < version) {
					old.deleted = true;
					old.version = version;
					this.flags[key] = old;
				}
			} else {
				this.flags[key] = old;
			}

			cb();
		},
		upsert: function(key, flag, cb) {
			cb = cb || noop;
			var old = this.flags[key];

			if (this.flags.hasOwnProperty(key)) {
				var old = this.flags[key];
				if (old && old.version < flag.version) {
					this.flags[key] = flag;
				}
			} else {
				this.flags[key] = flag;
			}

			cb();
		},
		initialized: function() {
			return this.init_called === true;
		},
		close: function() {
			// Close on the in-memory store is a no-op
		},
	};
	return store;
}

// Deep clone an object. Does not preserve any
// functions on the object
function clone(obj) {
	return JSON.parse(JSON.stringify(obj));
}

module.exports = InMemoryFeatureStore;
