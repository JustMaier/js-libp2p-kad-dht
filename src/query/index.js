'use strict'

const mh = require('multihashes')

const utils = require('../utils')
const Run = require('./run')

/**
 * Divide peers up into disjoint paths (subqueries). Any peer can only be used once over all paths.
 * Within each path, query peers from closest to farthest away.
 */
class Query {
  /**
   * User-supplied function to set up an individual disjoint path. Per-path
   * query state should be held in this function's closure.
   * @typedef {makePath} function
   * @param {number} pathNum - Numeric index from zero to numPaths - 1
   * @returns {queryFunc} - Function to call on each peer in the query
   */

  /**
   * Query function.
   * @typedef {queryFunc} function
   * @param {PeerId} next - Peer to query
   * @param {function(Error, Object)} callback - Query result callback
   */

  /**
   * Create a new query. The makePath function is called once per disjoint path, so that per-path
   * variables can be created in that scope. makePath then returns the actual query function (queryFunc) to
   * use when on that path.
   *
   * @param {DHT} dht - DHT instance
   * @param {Buffer} key
   * @param {makePath} makePath - Called to set up each disjoint path. Must return the query function.
   */
  constructor (dht, key, makePath) {
    this.dht = dht
    this.key = key
    this.makePath = makePath
    this._log = utils.logger(this.dht.peerInfo.id, 'query:' + mh.toB58String(key))

    this.running = false

    this._onStart = this._onStart.bind(this)
    this._onComplete = this._onComplete.bind(this)
  }

  /**
   * Run this query, start with the given list of peers first.
   *
   * @param {Array<PeerId>} peers
   * @returns {Promise}
   */
  async run (peers) {
    if (!this.dht._queryManager.running) {
      this._log.error('Attempt to run query after shutdown')
      return { finalSet: new Set(), paths: [] }
    }

    if (peers.length === 0) {
      this._log.error('Running query with no peers')
      return { finalSet: new Set(), paths: [] }
    }

    this._run = new Run(this)

    this._log(`query running with K=${this.dht.kBucketSize}, A=${this.dht.concurrency}, D=${Math.min(this.dht.disjointPaths, peers.length)}`)
    this._run.once('start', this._onStart)
    this._run.once('complete', this._onComplete)
    return this._run.execute(peers)
  }

  /**
   * Called when the run starts.
   */
  _onStart () {
    this.running = true
    this._startTime = Date.now()
    this._log('query:start')

    // Register this query so we can stop it if the DHT stops
    this.dht._queryManager.queryStarted(this)
  }

  /**
   * Called when the run completes (even if there's an error).
   */
  _onComplete () {
    // Ensure worker queues for all paths are stopped at the end of the query
    this.stop()
  }

  /**
   * Stop the query.
   */
  stop () {
    this._log(`query:done in ${Date.now() - this._startTime}ms`)

    if (this._run) {
      this._log(`${this._run.errors.length} of ${this._run.peersSeen.size} peers errored (${this._run.errors.length / this._run.peersSeen.size * 100}% fail rate)`)
    }

    if (!this.running) {
      return
    }

    this._run.removeListener('start', this._onStart)
    this._run.removeListener('complete', this._onComplete)

    this.running = false
    this._run && this._run.stop()
    this.dht._queryManager.queryCompleted(this)
  }
}

module.exports = Query
