/**
 * Debounce: Execute function ONCE after delay, cancelling previous calls
 * Use for: Search, autocomplete, resize, text input
 */
export function debounce(func, delay) {
  let timeoutId;
  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}

/**
 * Throttle: Execute function AT MOST once per delay interval
 * Use for: Scroll, button clicks, continuous updates
 */
export function throttle(func, delay) {
  let lastCall = 0;
  return function throttled(...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    }
  };
}

/**
 * Request Deduplicator: Prevent multiple identical simultaneous requests
 * Tracks in-flight requests and reuses their promise
 */
export class RequestDeduplicator {
  constructor() {
    this.inFlightRequests = new Map(); // key -> promise
  }

  async execute(key, asyncFn) {
    // If request is already in flight, return existing promise
    if (this.inFlightRequests.has(key)) {
      return this.inFlightRequests.get(key);
    }

    // Create new promise and store it
    const promise = asyncFn()
      .finally(() => {
        // Remove from tracking after completion (success or failure)
        this.inFlightRequests.delete(key);
      });

    this.inFlightRequests.set(key, promise);
    return promise;
  }

  hasPending(key) {
    return this.inFlightRequests.has(key);
  }

  clear() {
    this.inFlightRequests.clear();
  }
}

/**
 * Request Queue: Execute requests sequentially to avoid parallelism issues
 */
export class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  async add(asyncFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn: asyncFn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const { fn, resolve, reject } = this.queue.shift();

    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    }

    this.processing = false;
    if (this.queue.length > 0) {
      this.process();
    }
  }

  clear() {
    this.queue = [];
    this.processing = false;
  }
}
