const proc =
  typeof process === 'object' && process
    ? process
    : {
        stdout: null,
        stderr: null,
      }
import { EventEmitter } from 'node:events'
import Stream from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

/**
 * Same as StringDecoder, but exposing the `lastNeed` flag on the type
 */
type SD = StringDecoder & { lastNeed: boolean }

export type { SD, Pipe, PipeProxyErrors }

/**
 * Return true if the argument is a Minipass stream, Node stream, or something
 * else that Minipass can interact with.
 */
export const isStream = (
  s: any
): s is Minipass.Readable | Minipass.Writable =>
  !!s &&
  typeof s === 'object' &&
  (s instanceof Minipass ||
    s instanceof Stream ||
    isReadable(s) ||
    isWritable(s))

/**
 * Return true if the argument is a valid {@link Minipass.Readable}
 */
export const isReadable = (s: any): s is Minipass.Readable =>
  !!s &&
  typeof s === 'object' &&
  s instanceof EventEmitter &&
  typeof (s as Minipass.Readable).pipe === 'function' &&
  // node core Writable streams have a pipe() method, but it throws
  (s as Minipass.Readable).pipe !== Stream.Writable.prototype.pipe

/**
 * Return true if the argument is a valid {@link Minipass.Writable}
 */
export const isWritable = (s: any): s is Minipass.Readable =>
  !!s &&
  typeof s === 'object' &&
  s instanceof EventEmitter &&
  typeof (s as Minipass.Writable).write === 'function' &&
  typeof (s as Minipass.Writable).end === 'function'

const EOF = Symbol('EOF')
const MAYBE_EMIT_END = Symbol('maybeEmitEnd')
const EMITTED_END = Symbol('emittedEnd')
const EMITTING_END = Symbol('emittingEnd')
const EMITTED_ERROR = Symbol('emittedError')
const CLOSED = Symbol('closed')
const READ = Symbol('read')
const FLUSH = Symbol('flush')
const FLUSHCHUNK = Symbol('flushChunk')
const ENCODING = Symbol('encoding')
const DECODER = Symbol('decoder')
const FLOWING = Symbol('flowing')
const PAUSED = Symbol('paused')
const RESUME = Symbol('resume')
const BUFFER = Symbol('buffer')
const PIPES = Symbol('pipes')
const BUFFERLENGTH = Symbol('bufferLength')
const BUFFERPUSH = Symbol('bufferPush')
const BUFFERSHIFT = Symbol('bufferShift')
const OBJECTMODE = Symbol('objectMode')
// internal event when stream is destroyed
const DESTROYED = Symbol('destroyed')
// internal event when stream has an error
const ERROR = Symbol('error')
const EMITDATA = Symbol('emitData')
const EMITEND = Symbol('emitEnd')
const EMITEND2 = Symbol('emitEnd2')
const ASYNC = Symbol('async')
const ABORT = Symbol('abort')
const ABORTED = Symbol('aborted')
const SIGNAL = Symbol('signal')
const DATALISTENERS = Symbol('dataListeners')
const DISCARDED = Symbol('discarded')

const defer = (fn: (...a: any[]) => any) => Promise.resolve().then(fn)
const nodefer = (fn: (...a: any[]) => any) => fn()

// events that mean 'the stream is over'
// these are treated specially, and re-emitted
// if they are listened for after emitting.
type EndishEvent = 'end' | 'finish' | 'prefinish'
const isEndish = (ev: any): ev is EndishEvent =>
  ev === 'end' || ev === 'finish' || ev === 'prefinish'

const isArrayBufferLike = (b: any): b is ArrayBufferLike =>
  b instanceof ArrayBuffer ||
  (!!b &&
    typeof b === 'object' &&
    b.constructor &&
    b.constructor.name === 'ArrayBuffer' &&
    b.byteLength >= 0)

const isArrayBufferView = (b: any): b is ArrayBufferView =>
  !Buffer.isBuffer(b) && ArrayBuffer.isView(b)

/**
 * Options that may be passed to stream.pipe()
 */
export interface PipeOptions {
  /**
   * end the destination stream when the source stream ends
   */
  end?: boolean
  /**
   * proxy errors from the source stream to the destination stream
   */
  proxyErrors?: boolean
}

/**
 * Internal class representing a pipe to a destination stream.
 *
 * @internal
 */
class Pipe<T extends unknown> {
  src: Minipass<T>
  dest: Minipass<any, T>
  opts: PipeOptions
  ondrain: () => any
  constructor(
    src: Minipass<T>,
    dest: Minipass.Writable,
    opts: PipeOptions
  ) {
    this.src = src
    this.dest = dest as Minipass<any, T>
    this.opts = opts
    this.ondrain = () => src[RESUME]()
    this.dest.on('drain', this.ondrain)
  }
  unpipe() {
    this.dest.removeListener('drain', this.ondrain)
  }
  // only here for the prototype
  /* c8 ignore start */
  proxyErrors(_er: any) {}
  /* c8 ignore stop */
  end() {
    this.unpipe()
    if (this.opts.end) this.dest.end()
  }
}

/**
 * Internal class representing a pipe to a destination stream where
 * errors are proxied.
 *
 * @internal
 */
class PipeProxyErrors<T> extends Pipe<T> {
  unpipe() {
    this.src.removeListener('error', this.proxyErrors)
    super.unpipe()
  }
  constructor(
    src: Minipass<T>,
    dest: Minipass.Writable,
    opts: PipeOptions
  ) {
    super(src, dest, opts)
    this.proxyErrors = er => dest.emit('error', er)
    src.on('error', this.proxyErrors)
  }
}

export namespace Minipass {
  /**
   * Encoding used to create a stream that outputs strings rather than
   * Buffer objects.
   */
  export type Encoding = BufferEncoding | 'buffer' | null

  /**
   * Any stream that Minipass can pipe into
   */
  export type Writable =
    | Minipass<any, any, any>
    | NodeJS.WriteStream
    | (NodeJS.WriteStream & { fd: number })
    | (EventEmitter & {
        end(): any
        write(chunk: any, ...args: any[]): any
      })

  /**
   * Any stream that can be read from
   */
  export type Readable =
    | Minipass<any, any, any>
    | NodeJS.ReadStream
    | (NodeJS.ReadStream & { fd: number })
    | (EventEmitter & {
        pause(): any
        resume(): any
        pipe(...destArgs: any[]): any
      })

  /**
   * Utility type that can be iterated sync or async
   */
  export type DualIterable<T> = Iterable<T> & AsyncIterable<T>

  type EventArguments = Record<string | symbol, unknown[]>

  /**
   * The listing of events that a Minipass class can emit.
   * Extend this when extending the Minipass class, and pass as
   * the third template argument.  The key is the name of the event,
   * and the value is the argument list.
   *
   * Any undeclared events will still be allowed, but the handler will get
   * arguments as `unknown[]`.
   */
  export interface Events<RType extends any = Buffer>
    extends EventArguments {
    readable: []
    data: [chunk: RType]
    error: [er: unknown]
    abort: [reason: unknown]
    drain: []
    resume: []
    end: []
    finish: []
    prefinish: []
    close: []
    [DESTROYED]: [er?: unknown]
    [ERROR]: [er: unknown]
  }

  /**
   * String or buffer-like data that can be joined and sliced
   */
  export type ContiguousData =
    | Buffer
    | ArrayBufferLike
    | ArrayBufferView
    | string
  export type BufferOrString = Buffer | string

  /**
   * Options passed to the Minipass constructor.
   */
  export type SharedOptions = {
    /**
     * Defer all data emission and other events until the end of the
     * current tick, similar to Node core streams
     */
    async?: boolean
    /**
     * A signal which will abort the stream
     */
    signal?: AbortSignal
    /**
     * Output string encoding. Set to `null` or `'buffer'` (or omit) to
     * emit Buffer objects rather than strings.
     *
     * Conflicts with `objectMode`
     */
    encoding?: BufferEncoding | null | 'buffer'
    /**
     * Output data exactly as it was written, supporting non-buffer/string
     * data (such as arbitrary objects, falsey values, etc.)
     *
     * Conflicts with `encoding`
     */
    objectMode?: boolean
  }

  /**
   * Options for a string encoded output
   */
  export type EncodingOptions = SharedOptions & {
    encoding: BufferEncoding
    objectMode?: false
  }

  /**
   * Options for contiguous data buffer output
   */
  export type BufferOptions = SharedOptions & {
    encoding?: null | 'buffer'
    objectMode?: false
  }

  /**
   * Options for objectMode arbitrary output
   */
  export type ObjectModeOptions = SharedOptions & {
    objectMode: true
    encoding?: null
  }

  /**
   * Utility type to determine allowed options based on read type
   */
  export type Options<T> = T extends string
    ? EncodingOptions | ObjectModeOptions
    : T extends Buffer
    ? BufferOptions | ObjectModeOptions
    : SharedOptions
}

const isObjectModeOptions = (
  o: Minipass.SharedOptions
): o is Minipass.ObjectModeOptions => !!o.objectMode

const isEncodingOptions = (
  o: Minipass.SharedOptions
): o is Minipass.EncodingOptions =>
  !o.objectMode && !!o.encoding && o.encoding !== 'buffer'

/**
 * Main export, the Minipass class
 *
 * `RType` is the type of data emitted, defaults to Buffer
 *
 * `WType` is the type of data to be written, if RType is buffer or string,
 * then any {@link Minipass.ContiguousData} is allowed.
 *
 * `Events` is the set of event handler signatures that this object
 * will emit, see {@link Minipass.Events}
 */
export class Minipass<
    RType extends unknown = Buffer,
    WType extends unknown = RType extends Minipass.BufferOrString
      ? Minipass.ContiguousData
      : RType,
    Events extends Minipass.Events<RType> = Minipass.Events<RType>
  >
  extends EventEmitter
  implements Minipass.DualIterable<RType>
{
  [FLOWING]: boolean = false;
  [PAUSED]: boolean = false;
  [PIPES]: Pipe<RType>[] = [];
  [BUFFER]: RType[] = [];
  [OBJECTMODE]: boolean;
  [ENCODING]: BufferEncoding | null;
  [ASYNC]: boolean;
  [DECODER]: SD | null;
  [EOF]: boolean = false;
  [EMITTED_END]: boolean = false;
  [EMITTING_END]: boolean = false;
  [CLOSED]: boolean = false;
  [EMITTED_ERROR]: unknown = null;
  [BUFFERLENGTH]: number = 0;
  [DESTROYED]: boolean = false;
  [SIGNAL]?: AbortSignal;
  [ABORTED]: boolean = false;
  [DATALISTENERS]: number = 0;
  [DISCARDED]: boolean = false

  /**
   * true if the stream can be written
   */
  writable: boolean = true
  /**
   * true if the stream can be read
   */
  readable: boolean = true

  /**
   * If `RType` is Buffer, then options do not need to be provided.
   * Otherwise, an options object must be provided to specify either
   * {@link Minipass.SharedOptions.objectMode} or
   * {@link Minipass.SharedOptions.encoding}, as appropriate.
   */
  constructor(
    ...args: RType extends Buffer
      ? [] | [Minipass.Options<RType>]
      : [Minipass.Options<RType>]
  ) {
    const options: Minipass.Options<RType> = (args[0] ||
      {}) as Minipass.Options<RType>
    super()
    if (options.objectMode && typeof options.encoding === 'string') {
      throw new TypeError(
        'Encoding and objectMode may not be used together'
      )
    }
    if (isObjectModeOptions(options)) {
      this[OBJECTMODE] = true
      this[ENCODING] = null
    } else if (isEncodingOptions(options)) {
      this[ENCODING] = options.encoding
      this[OBJECTMODE] = false
    } else {
      this[OBJECTMODE] = false
      this[ENCODING] = null
    }
    this[ASYNC] = !!options.async
    this[DECODER] = this[ENCODING]
      ? (new StringDecoder(this[ENCODING]) as SD)
      : null

    //@ts-ignore - private option for debugging and testing
    if (options && options.debugExposeBuffer === true) {
      Object.defineProperty(this, 'buffer', { get: () => this[BUFFER] })
    }
    //@ts-ignore - private option for debugging and testing
    if (options && options.debugExposePipes === true) {
      Object.defineProperty(this, 'pipes', { get: () => this[PIPES] })
    }

    const { signal } = options
    if (signal) {
      this[SIGNAL] = signal
      if (signal.aborted) {
        this[ABORT]()
      } else {
        signal.addEventListener('abort', () => this[ABORT]())
      }
    }
  }

  /**
   * The amount of data stored in the buffer waiting to be read.
   *
   * For Buffer strings, this will be the total byte length.
   * For string encoding streams, this will be the string character length,
   * according to JavaScript's `string.length` logic.
   * For objectMode streams, this is a count of the items waiting to be
   * emitted.
   */
  get bufferLength() {
    return this[BUFFERLENGTH]
  }

  /**
   * The `BufferEncoding` currently in use, or `null`
   */
  get encoding() {
    return this[ENCODING]
  }

  /**
   * @deprecated - This is a read only property
   */
  set encoding(_enc) {
    throw new Error('Encoding must be set at instantiation time')
  }

  /**
   * @deprecated - Encoding may only be set at instantiation time
   */
  setEncoding(_enc: Minipass.Encoding) {
    throw new Error('Encoding must be set at instantiation time')
  }

  /**
   * True if this is an objectMode stream
   */
  get objectMode() {
    return this[OBJECTMODE]
  }

  /**
   * @deprecated - This is a read-only property
   */
  set objectMode(_om) {
    throw new Error('objectMode must be set at instantiation time')
  }

  /**
   * true if this is an async stream
   */
  get ['async'](): boolean {
    return this[ASYNC]
  }
  /**
   * Set to true to make this stream async.
   *
   * Once set, it cannot be unset, as this would potentially cause incorrect
   * behavior.  Ie, a sync stream can be made async, but an async stream
   * cannot be safely made sync.
   */
  set ['async'](a: boolean) {
    this[ASYNC] = this[ASYNC] || !!a
  }

  // drop everything and get out of the flow completely
  [ABORT]() {
    this[ABORTED] = true
    this.emit('abort', this[SIGNAL]?.reason)
    this.destroy(this[SIGNAL]?.reason)
  }

  /**
   * True if the stream has been aborted.
   */
  get aborted() {
    return this[ABORTED]
  }
  /**
   * No-op setter. Stream aborted status is set via the AbortSignal provided
   * in the constructor options.
   */
  set aborted(_) {}

  /**
   * Write data into the stream
   *
   * If the chunk written is a string, and encoding is not specified, then
   * `utf8` will be assumed. If the stream encoding matches the encoding of
   * a written string, and the state of the string decoder allows it, then
   * the string will be passed through to either the output or the internal
   * buffer without any processing. Otherwise, it will be turned into a
   * Buffer object for processing into the desired encoding.
   *
   * If provided, `cb` function is called immediately before return for
   * sync streams, or on next tick for async streams, because for this
   * base class, a chunk is considered "processed" once it is accepted
   * and either emitted or buffered. That is, the callback does not indicate
   * that the chunk has been eventually emitted, though of course child
   * classes can override this function to do whatever processing is required
   * and call `super.write(...)` only once processing is completed.
   */
  write(chunk: WType, cb?: () => void): boolean
  write(
    chunk: WType,
    encoding?: Minipass.Encoding,
    cb?: () => void
  ): boolean
  write(
    chunk: WType,
    encoding?: Minipass.Encoding | (() => void),
    cb?: () => void
  ): boolean {
    if (this[ABORTED]) return false
    if (this[EOF]) throw new Error('write after end')

    if (this[DESTROYED]) {
      this.emit(
        'error',
        Object.assign(
          new Error('Cannot call write after a stream was destroyed'),
          { code: 'ERR_STREAM_DESTROYED' }
        )
      )
      return true
    }

    if (typeof encoding === 'function') {
      cb = encoding
      encoding = 'utf8'
    }

    if (!encoding) encoding = 'utf8'

    const fn = this[ASYNC] ? defer : nodefer

    // convert array buffers and typed array views into buffers
    // at some point in the future, we may want to do the opposite!
    // leave strings and buffers as-is
    // anything is only allowed if in object mode, so throw
    if (!this[OBJECTMODE] && !Buffer.isBuffer(chunk)) {
      if (isArrayBufferView(chunk)) {
        //@ts-ignore - sinful unsafe type changing
        chunk = Buffer.from(
          chunk.buffer,
          chunk.byteOffset,
          chunk.byteLength
        )
      } else if (isArrayBufferLike(chunk)) {
        //@ts-ignore - sinful unsafe type changing
        chunk = Buffer.from(chunk)
      } else if (typeof chunk !== 'string') {
        throw new Error(
          'Non-contiguous data written to non-objectMode stream'
        )
      }
    }

    // handle object mode up front, since it's simpler
    // this yields better performance, fewer checks later.
    if (this[OBJECTMODE]) {
      // maybe impossible?
      /* c8 ignore start */
      if (this[FLOWING] && this[BUFFERLENGTH] !== 0) this[FLUSH](true)
      /* c8 ignore stop */

      if (this[FLOWING]) this.emit('data', chunk as unknown as RType)
      else this[BUFFERPUSH](chunk as unknown as RType)

      if (this[BUFFERLENGTH] !== 0) this.emit('readable')

      if (cb) fn(cb)

      return this[FLOWING]
    }

    // at this point the chunk is a buffer or string
    // don't buffer it up or send it to the decoder
    if (!(chunk as Minipass.BufferOrString).length) {
      if (this[BUFFERLENGTH] !== 0) this.emit('readable')
      if (cb) fn(cb)
      return this[FLOWING]
    }

    // fast-path writing strings of same encoding to a stream with
    // an empty buffer, skipping the buffer/decoder dance
    if (
      typeof chunk === 'string' &&
      // unless it is a string already ready for us to use
      !(encoding === this[ENCODING] && !this[DECODER]?.lastNeed)
    ) {
      //@ts-ignore - sinful unsafe type change
      chunk = Buffer.from(chunk, encoding)
    }

    if (Buffer.isBuffer(chunk) && this[ENCODING]) {
      //@ts-ignore - sinful unsafe type change
      chunk = this[DECODER].write(chunk)
    }

    // Note: flushing CAN potentially switch us into not-flowing mode
    if (this[FLOWING] && this[BUFFERLENGTH] !== 0) this[FLUSH](true)

    if (this[FLOWING]) this.emit('data', chunk as unknown as RType)
    else this[BUFFERPUSH](chunk as unknown as RType)

    if (this[BUFFERLENGTH] !== 0) this.emit('readable')

    if (cb) fn(cb)

    return this[FLOWING]
  }

  /**
   * Low-level explicit read method.
   *
   * In objectMode, the argument is ignored, and one item is returned if
   * available.
   *
   * `n` is the number of bytes (or in the case of encoding streams,
   * characters) to consume. If `n` is not provided, then the entire buffer
   * is returned, or `null` is returned if no data is available.
   *
   * If `n` is greater that the amount of data in the internal buffer,
   * then `null` is returned.
   */
  read(n?: number | null): RType | null {
    if (this[DESTROYED]) return null
    this[DISCARDED] = false

    if (
      this[BUFFERLENGTH] === 0 ||
      n === 0 ||
      (n && n > this[BUFFERLENGTH])
    ) {
      this[MAYBE_EMIT_END]()
      return null
    }

    if (this[OBJECTMODE]) n = null

    if (this[BUFFER].length > 1 && !this[OBJECTMODE]) {
      // not object mode, so if we have an encoding, then RType is string
      // otherwise, must be Buffer
      this[BUFFER] = [
        (this[ENCODING]
          ? this[BUFFER].join('')
          : Buffer.concat(
              this[BUFFER] as Buffer[],
              this[BUFFERLENGTH]
            )) as RType,
      ]
    }

    const ret = this[READ](n || null, this[BUFFER][0])
    this[MAYBE_EMIT_END]()
    return ret
  }

  [READ](n: number | null, chunk: RType) {
    if (this[OBJECTMODE]) this[BUFFERSHIFT]()
    else {
      const c = chunk as Minipass.BufferOrString
      if (n === c.length || n === null) this[BUFFERSHIFT]()
      else if (typeof c === 'string') {
        this[BUFFER][0] = c.slice(n) as RType
        chunk = c.slice(0, n) as RType
        this[BUFFERLENGTH] -= n
      } else {
        this[BUFFER][0] = c.subarray(n) as RType
        chunk = c.subarray(0, n) as RType
        this[BUFFERLENGTH] -= n
      }
    }

    this.emit('data', chunk)

    if (!this[BUFFER].length && !this[EOF]) this.emit('drain')

    return chunk
  }

  /**
   * End the stream, optionally providing a final write.
   *
   * See {@link Minipass#write} for argument descriptions
   */
  end(cb?: () => void): this
  end(chunk: WType, cb?: () => void): this
  end(chunk: WType, encoding?: Minipass.Encoding, cb?: () => void): this
  end(
    chunk?: WType | (() => void),
    encoding?: Minipass.Encoding | (() => void),
    cb?: () => void
  ) {
    if (typeof chunk === 'function') {
      cb = chunk as () => void
      chunk = undefined
    }
    if (typeof encoding === 'function') {
      cb = encoding
      encoding = 'utf8'
    }
    if (chunk !== undefined) this.write(chunk, encoding)
    if (cb) this.once('end', cb)
    this[EOF] = true
    this.writable = false

    // if we haven't written anything, then go ahead and emit,
    // even if we're not reading.
    // we'll re-emit if a new 'end' listener is added anyway.
    // This makes MP more suitable to write-only use cases.
    if (this[FLOWING] || !this[PAUSED]) this[MAYBE_EMIT_END]()
    return this
  }

  // don't let the internal resume be overwritten
  [RESUME]() {
    if (this[DESTROYED]) return

    if (!this[DATALISTENERS] && !this[PIPES].length) {
      this[DISCARDED] = true
    }
    this[PAUSED] = false
    this[FLOWING] = true
    this.emit('resume')
    if (this[BUFFER].length) this[FLUSH]()
    else if (this[EOF]) this[MAYBE_EMIT_END]()
    else this.emit('drain')
  }

  /**
   * Resume the stream if it is currently in a paused state
   *
   * If called when there are no pipe destinations or `data` event listeners,
   * this will place the stream in a "discarded" state, where all data will
   * be thrown away. The discarded state is removed if a pipe destination or
   * data handler is added, if pause() is called, or if any synchronous or
   * asynchronous iteration is started.
   */
  resume() {
    return this[RESUME]()
  }

  /**
   * Pause the stream
   */
  pause() {
    this[FLOWING] = false
    this[PAUSED] = true
    this[DISCARDED] = false
  }

  /**
   * true if the stream has been forcibly destroyed
   */
  get destroyed() {
    return this[DESTROYED]
  }

  /**
   * true if the stream is currently in a flowing state, meaning that
   * any writes will be immediately emitted.
   */
  get flowing() {
    return this[FLOWING]
  }

  /**
   * true if the stream is currently in a paused state
   */
  get paused() {
    return this[PAUSED]
  }

  [BUFFERPUSH](chunk: RType) {
    if (this[OBJECTMODE]) this[BUFFERLENGTH] += 1
    else this[BUFFERLENGTH] += (chunk as Minipass.BufferOrString).length
    this[BUFFER].push(chunk)
  }

  [BUFFERSHIFT](): RType {
    if (this[OBJECTMODE]) this[BUFFERLENGTH] -= 1
    else
      this[BUFFERLENGTH] -= (
        this[BUFFER][0] as Minipass.BufferOrString
      ).length
    return this[BUFFER].shift() as RType
  }

  [FLUSH](noDrain: boolean = false) {
    do {} while (
      this[FLUSHCHUNK](this[BUFFERSHIFT]()) &&
      this[BUFFER].length
    )

    if (!noDrain && !this[BUFFER].length && !this[EOF]) this.emit('drain')
  }

  [FLUSHCHUNK](chunk: RType) {
    this.emit('data', chunk)
    return this[FLOWING]
  }

  /**
   * Pipe all data emitted by this stream into the destination provided.
   *
   * Triggers the flow of data.
   */
  pipe<W extends Minipass.Writable>(dest: W, opts?: PipeOptions): W {
    if (this[DESTROYED]) return dest
    this[DISCARDED] = false

    const ended = this[EMITTED_END]
    opts = opts || {}
    if (dest === proc.stdout || dest === proc.stderr) opts.end = false
    else opts.end = opts.end !== false
    opts.proxyErrors = !!opts.proxyErrors

    // piping an ended stream ends immediately
    if (ended) {
      if (opts.end) dest.end()
    } else {
      // "as" here just ignores the WType, which pipes don't care about,
      // since they're only consuming from us, and writing to the dest
      this[PIPES].push(
        !opts.proxyErrors
          ? new Pipe<RType>(this as Minipass<RType>, dest, opts)
          : new PipeProxyErrors<RType>(this as Minipass<RType>, dest, opts)
      )
      if (this[ASYNC]) defer(() => this[RESUME]())
      else this[RESUME]()
    }

    return dest
  }

  /**
   * Fully unhook a piped destination stream.
   *
   * If the destination stream was the only consumer of this stream (ie,
   * there are no other piped destinations or `'data'` event listeners)
   * then the flow of data will stop until there is another consumer or
   * {@link Minipass#resume} is explicitly called.
   */
  unpipe<W extends Minipass.Writable>(dest: W) {
    const p = this[PIPES].find(p => p.dest === dest)
    if (p) {
      if (this[PIPES].length === 1) {
        if (this[FLOWING] && this[DATALISTENERS] === 0) {
          this[FLOWING] = false
        }
        this[PIPES] = []
      } else this[PIPES].splice(this[PIPES].indexOf(p), 1)
      p.unpipe()
    }
  }

  /**
   * Alias for {@link Minipass#on}
   */
  addListener<Event extends keyof Events>(
    ev: Event,
    handler: (...args: Events[Event]) => any
  ): this {
    return this.on(ev, handler)
  }

  /**
   * Mostly identical to `EventEmitter.on`, with the following
   * behavior differences to prevent data loss and unnecessary hangs:
   *
   * - Adding a 'data' event handler will trigger the flow of data
   *
   * - Adding a 'readable' event handler when there is data waiting to be read
   *   will cause 'readable' to be emitted immediately.
   *
   * - Adding an 'endish' event handler ('end', 'finish', etc.) which has
   *   already passed will cause the event to be emitted immediately and all
   *   handlers removed.
   *
   * - Adding an 'error' event handler after an error has been emitted will
   *   cause the event to be re-emitted immediately with the error previously
   *   raised.
   */
  on<Event extends keyof Events>(
    ev: Event,
    handler: (...args: Events[Event]) => any
  ): this {
    const ret = super.on(
      ev as string | symbol,
      handler as (...a: any[]) => any
    )
    if (ev === 'data') {
      this[DISCARDED] = false
      this[DATALISTENERS]++
      if (!this[PIPES].length && !this[FLOWING]) {
        this[RESUME]()
      }
    } else if (ev === 'readable' && this[BUFFERLENGTH] !== 0) {
      super.emit('readable')
    } else if (isEndish(ev) && this[EMITTED_END]) {
      super.emit(ev)
      this.removeAllListeners(ev)
    } else if (ev === 'error' && this[EMITTED_ERROR]) {
      const h = handler as (...a: Events['error']) => any
      if (this[ASYNC]) defer(() => h.call(this, this[EMITTED_ERROR]))
      else h.call(this, this[EMITTED_ERROR])
    }
    return ret
  }

  /**
   * Alias for {@link Minipass#off}
   */
  removeListener<Event extends keyof Events>(
    ev: Event,
    handler: (...args: Events[Event]) => any
  ) {
    return this.off(ev, handler)
  }

  /**
   * Mostly identical to `EventEmitter.off`
   *
   * If a 'data' event handler is removed, and it was the last consumer
   * (ie, there are no pipe destinations or other 'data' event listeners),
   * then the flow of data will stop until there is another consumer or
   * {@link Minipass#resume} is explicitly called.
   */
  off<Event extends keyof Events>(
    ev: Event,
    handler: (...args: Events[Event]) => any
  ) {
    const ret = super.off(
      ev as string | symbol,
      handler as (...a: any[]) => any
    )
    // if we previously had listeners, and now we don't, and we don't
    // have any pipes, then stop the flow, unless it's been explicitly
    // put in a discarded flowing state via stream.resume().
    if (ev === 'data') {
      this[DATALISTENERS] = this.listeners('data').length
      if (
        this[DATALISTENERS] === 0 &&
        !this[DISCARDED] &&
        !this[PIPES].length
      ) {
        this[FLOWING] = false
      }
    }
    return ret
  }

  /**
   * Mostly identical to `EventEmitter.removeAllListeners`
   *
   * If all 'data' event handlers are removed, and they were the last consumer
   * (ie, there are no pipe destinations), then the flow of data will stop
   * until there is another consumer or {@link Minipass#resume} is explicitly
   * called.
   */
  removeAllListeners<Event extends keyof Events>(ev?: Event) {
    const ret = super.removeAllListeners(ev as string | symbol | undefined)
    if (ev === 'data' || ev === undefined) {
      this[DATALISTENERS] = 0
      if (!this[DISCARDED] && !this[PIPES].length) {
        this[FLOWING] = false
      }
    }
    return ret
  }

  /**
   * true if the 'end' event has been emitted
   */
  get emittedEnd() {
    return this[EMITTED_END]
  }

  [MAYBE_EMIT_END]() {
    if (
      !this[EMITTING_END] &&
      !this[EMITTED_END] &&
      !this[DESTROYED] &&
      this[BUFFER].length === 0 &&
      this[EOF]
    ) {
      this[EMITTING_END] = true
      this.emit('end')
      this.emit('prefinish')
      this.emit('finish')
      if (this[CLOSED]) this.emit('close')
      this[EMITTING_END] = false
    }
  }

  /**
   * Mostly identical to `EventEmitter.emit`, with the following
   * behavior differences to prevent data loss and unnecessary hangs:
   *
   * If the stream has been destroyed, and the event is something other
   * than 'close' or 'error', then `false` is returned and no handlers
   * are called.
   *
   * If the event is 'end', and has already been emitted, then the event
   * is ignored. If the stream is in a paused or non-flowing state, then
   * the event will be deferred until data flow resumes. If the stream is
   * async, then handlers will be called on the next tick rather than
   * immediately.
   *
   * If the event is 'close', and 'end' has not yet been emitted, then
   * the event will be deferred until after 'end' is emitted.
   *
   * If the event is 'error', and an AbortSignal was provided for the stream,
   * and there are no listeners, then the event is ignored, matching the
   * behavior of node core streams in the presense of an AbortSignal.
   *
   * If the event is 'finish' or 'prefinish', then all listeners will be
   * removed after emitting the event, to prevent double-firing.
   */
  emit<Event extends keyof Events>(
    ev: Event,
    ...args: Events[Event]
  ): boolean {
    const data = args[0]
    // error and close are only events allowed after calling destroy()
    if (
      ev !== 'error' &&
      ev !== 'close' &&
      ev !== DESTROYED &&
      this[DESTROYED]
    ) {
      return false
    } else if (ev === 'data') {
      return !this[OBJECTMODE] && !data
        ? false
        : this[ASYNC]
        ? (defer(() => this[EMITDATA](data as RType)), true)
        : this[EMITDATA](data as RType)
    } else if (ev === 'end') {
      return this[EMITEND]()
    } else if (ev === 'close') {
      this[CLOSED] = true
      // don't emit close before 'end' and 'finish'
      if (!this[EMITTED_END] && !this[DESTROYED]) return false
      const ret = super.emit('close')
      this.removeAllListeners('close')
      return ret
    } else if (ev === 'error') {
      this[EMITTED_ERROR] = data
      super.emit(ERROR, data)
      const ret =
        !this[SIGNAL] || this.listeners('error').length
          ? super.emit('error', data)
          : false
      this[MAYBE_EMIT_END]()
      return ret
    } else if (ev === 'resume') {
      const ret = super.emit('resume')
      this[MAYBE_EMIT_END]()
      return ret
    } else if (ev === 'finish' || ev === 'prefinish') {
      const ret = super.emit(ev)
      this.removeAllListeners(ev)
      return ret
    }

    // Some other unknown event
    const ret = super.emit(ev as string, ...args)
    this[MAYBE_EMIT_END]()
    return ret
  }

  [EMITDATA](data: RType) {
    for (const p of this[PIPES]) {
      if (p.dest.write(data) === false) this.pause()
    }
    const ret = this[DISCARDED] ? false : super.emit('data', data)
    this[MAYBE_EMIT_END]()
    return ret
  }

  [EMITEND]() {
    if (this[EMITTED_END]) return false

    this[EMITTED_END] = true
    this.readable = false
    return this[ASYNC]
      ? (defer(() => this[EMITEND2]()), true)
      : this[EMITEND2]()
  }

  [EMITEND2]() {
    if (this[DECODER]) {
      const data = this[DECODER].end()
      if (data) {
        for (const p of this[PIPES]) {
          p.dest.write(data as RType)
        }
        if (!this[DISCARDED]) super.emit('data', data)
      }
    }

    for (const p of this[PIPES]) {
      p.end()
    }
    const ret = super.emit('end')
    this.removeAllListeners('end')
    return ret
  }

  /**
   * Return a Promise that resolves to an array of all emitted data once
   * the stream ends.
   */
  async collect(): Promise<RType[] & { dataLength: number }> {
    const buf: RType[] & { dataLength: number } = Object.assign([], {
      dataLength: 0,
    })
    if (!this[OBJECTMODE]) buf.dataLength = 0
    // set the promise first, in case an error is raised
    // by triggering the flow here.
    const p = this.promise()
    this.on('data', c => {
      buf.push(c)
      if (!this[OBJECTMODE])
        buf.dataLength += (c as Minipass.BufferOrString).length
    })
    await p
    return buf
  }

  /**
   * Return a Promise that resolves to the concatenation of all emitted data
   * once the stream ends.
   *
   * Not allowed on objectMode streams.
   */
  async concat(): Promise<RType> {
    if (this[OBJECTMODE]) {
      throw new Error('cannot concat in objectMode')
    }
    const buf = await this.collect()
    return (
      this[ENCODING]
        ? buf.join('')
        : Buffer.concat(buf as Buffer[], buf.dataLength)
    ) as RType
  }

  /**
   * Return a void Promise that resolves once the stream ends.
   */
  async promise(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.on(DESTROYED, () => reject(new Error('stream destroyed')))
      this.on('error', er => reject(er))
      this.on('end', () => resolve())
    })
  }

  /**
   * Asynchronous `for await of` iteration.
   *
   * This will continue emitting all chunks until the stream terminates.
   */
  [Symbol.asyncIterator](): AsyncGenerator<RType, void, void> {
    // set this up front, in case the consumer doesn't call next()
    // right away.
    this[DISCARDED] = false
    let stopped = false
    const stop = async (): Promise<IteratorReturnResult<void>> => {
      this.pause()
      stopped = true
      return { value: undefined, done: true }
    }
    const next = (): Promise<IteratorResult<RType, void>> => {
      if (stopped) return stop()
      const res = this.read()
      if (res !== null) return Promise.resolve({ done: false, value: res })

      if (this[EOF]) return stop()

      let resolve!: (res: IteratorResult<RType>) => void
      let reject!: (er: unknown) => void
      const onerr = (er: unknown) => {
        this.off('data', ondata)
        this.off('end', onend)
        this.off(DESTROYED, ondestroy)
        stop()
        reject(er)
      }
      const ondata = (value: RType) => {
        this.off('error', onerr)
        this.off('end', onend)
        this.off(DESTROYED, ondestroy)
        this.pause()
        resolve({ value, done: !!this[EOF] })
      }
      const onend = () => {
        this.off('error', onerr)
        this.off('data', ondata)
        this.off(DESTROYED, ondestroy)
        stop()
        resolve({ done: true, value: undefined })
      }
      const ondestroy = () => onerr(new Error('stream destroyed'))
      return new Promise<IteratorResult<RType>>((res, rej) => {
        reject = rej
        resolve = res
        this.once(DESTROYED, ondestroy)
        this.once('error', onerr)
        this.once('end', onend)
        this.once('data', ondata)
      })
    }

    return {
      next,
      throw: stop,
      return: stop,
      [Symbol.asyncIterator]() {
        return this
      },
    }
  }

  /**
   * Synchronous `for of` iteration.
   *
   * The iteration will terminate when the internal buffer runs out, even
   * if the stream has not yet terminated.
   */
  [Symbol.iterator](): Generator<RType, void, void> {
    // set this up front, in case the consumer doesn't call next()
    // right away.
    this[DISCARDED] = false
    let stopped = false
    const stop = (): IteratorReturnResult<void> => {
      this.pause()
      this.off(ERROR, stop)
      this.off(DESTROYED, stop)
      this.off('end', stop)
      stopped = true
      return { done: true, value: undefined }
    }

    const next = (): IteratorResult<RType, void> => {
      if (stopped) return stop()
      const value = this.read()
      return value === null ? stop() : { done: false, value }
    }

    this.once('end', stop)
    this.once(ERROR, stop)
    this.once(DESTROYED, stop)

    return {
      next,
      throw: stop,
      return: stop,
      [Symbol.iterator]() {
        return this
      },
    }
  }

  /**
   * Destroy a stream, preventing it from being used for any further purpose.
   *
   * If the stream has a `close()` method, then it will be called on
   * destruction.
   *
   * After destruction, any attempt to write data, read data, or emit most
   * events will be ignored.
   *
   * If an error argument is provided, then it will be emitted in an
   * 'error' event.
   */
  destroy(er: unknown) {
    if (this[DESTROYED]) {
      if (er) this.emit('error', er)
      else this.emit(DESTROYED)
      return this
    }

    this[DESTROYED] = true
    this[DISCARDED] = true

    // throw away all buffered data, it's never coming out
    this[BUFFER].length = 0
    this[BUFFERLENGTH] = 0

    const wc = this as Minipass<RType, WType, Events> & {
      close?: () => void
    }
    if (typeof wc.close === 'function' && !this[CLOSED]) wc.close()

    if (er) this.emit('error', er)
    // if no error to emit, still reject pending promises
    else this.emit(DESTROYED)

    return this
  }

  /**
   * Alias for {@link isStream}
   *
   * Former export location, maintained for backwards compatibility.
   *
   * @deprecated
   */
  static get isStream() {
    return isStream
  }
}
