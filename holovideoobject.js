class HoloVideoObject {

    _createProgram(gl, vertexShaderSource, fragmentShaderSource, preLink) {

        function _createShader(gl, source, type) {
            var shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            return shader;
        }

        var program = gl.createProgram();
        var vshader = _createShader(gl, vertexShaderSource, gl.VERTEX_SHADER);
        gl.attachShader(program, vshader);
        gl.deleteShader(vshader);

        var fshader = _createShader(gl, fragmentShaderSource, gl.FRAGMENT_SHADER);
        gl.attachShader(program, fshader);
        gl.deleteShader(fshader);

        if (preLink) {
            preLink(program);
        }

        gl.linkProgram(program);

        var log = gl.getProgramInfoLog(program);
        if (log) {
            this._logError(log);
        }

        log = gl.getShaderInfoLog(vshader);
        if (log) {
            this._logError(log);
        }

        log = gl.getShaderInfoLog(fshader);
        if (log) {
            this._logError(log);
        }

        return program;
    }

    _loadJSON(src, callback) {

        // native json loading technique from @KryptoniteDove:
        // http://codepen.io/KryptoniteDove/post/load-json-file-locally-using-pure-javascript

        var xobj = new XMLHttpRequest();
        xobj.overrideMimeType("application/json");
        xobj.open('GET', src, true);
        xobj.onreadystatechange = function () {
            if (xobj.readyState == 4 && // Request finished, response ready
                xobj.status == "200") { // Status OK
                callback(xobj.responseText, this);
            }
        };
        xobj.send(null);
        return xobj.responseText;
    }

    _loadArrayBuffer(url, callback) {
        var xobj = new XMLHttpRequest();
        xobj.name = url.substring(url.lastIndexOf("/") + 1, url.length);
        xobj.responseType = 'arraybuffer';
        xobj.open('GET', url, true);
        xobj.onprogress = function(e) {
            if (e.lengthComputable) {
                var percentComplete = Math.floor((e.loaded / e.total) * 100);
                this._logInfo(xobj.name + " progress: " + percentComplete);
            }
        }.bind(this);
        xobj.onreadystatechange = function () {
            if (xobj.readyState == 4) { // Request finished, response ready
                if (xobj.status == "200") { // Status OK
                    var arrayBuffer = xobj.response;
                    if (arrayBuffer && callback) {
                        callback(arrayBuffer);
                    }
                }
                else {
                    this._logInfo("_loadArrayBuffer status = " + xobj.status);
                }
                if (this.httpRequest == xobj) {
                    this.httpRequest = null;
                }
            }
        }.bind(this);
        xobj.ontimeout = function () {
            this._logInfo("_loadArrayBuffer timeout");
        }
        xobj.send(null);
        this.httpRequest = xobj;
    }

    _startPlaybackIfReady() {

        if (this.state == HoloVideoObject.States.Opening) {
            if (this.buffersLoaded >= this.minBuffers && 
                this.videosLoaded >= this.minVideos) {
                this._logInfo("state -> Opened");
                this.state = HoloVideoObject.States.Opened;

                if (this.openOptions.autoplay) {
                    this.play();
                }
            }
        }
        // not else if
        if (this.suspended) {
            var timeline = this.json.extensions[HoloVideoObject._extName].timeline;
            var image = this.json.images[timeline[this.currentVideoIndex].image];
            var currentVideo = image.video;
            if ((currentVideo.paused || !currentVideo.playing) && currentVideo.preloaded) {
                this._logInfo("video " + currentVideo.mp4Name + " was suspended, resuming");
                this.suspended = false;
                currentVideo.play();
            }
        }
        else if (this.state == HoloVideoObject.States.Playing) {
            var timeline = this.json.extensions[HoloVideoObject._extName].timeline;
            var image = this.json.images[timeline[this.currentVideoIndex].image];
            var currentVideo = image.video;
            if (!currentVideo.playing) {
                currentVideo.play();
            }
        }
    }

    _loadNextBuffer() {

        if (this.freeArrayBuffers.length == 0) {
            this._logInfo("_loadNextBuffer no free buffer slot available");
            return;
        }

        var bufferIndex = this.nextBufferLoadIndex;
        this.nextBufferLoadIndex = (this.nextBufferLoadIndex + 1) % (this.json.buffers.length);

        if (this.fallbackFrameBuffer && this.nextBufferLoadIndex == 0)
        {
            this.nextBufferLoadIndex = 1;
        }

        var buffer = this.json.buffers[bufferIndex];
        var bufferName = buffer.uri;
        var bufferURL = this.urlRoot + bufferName;
        buffer.loaded = false;

        var arrayBufferIndex = -1;

        if (bufferIndex == 0) {
            this._logInfo("loading preview frame buffer");
        }

        else {
            arrayBufferIndex = this.freeArrayBuffers.shift();
            this._logInfo("loading buffer: " + buffer.uri + " into slot " + arrayBufferIndex);
        }

        this.pendingBufferDownload = true;
        this._loadArrayBuffer(bufferURL, function(arrayBuffer) {

            this._logInfo("buffer loaded: " + buffer.uri);

            if (!this.fallbackFrameBuffer && !this.filledFallbackFrame) {
                this._logInfo("fallback frame buffer downloaded " + buffer.uri);
                this.fallbackFrameBuffer = arrayBuffer;
                this._loadNextBuffer();
                this.pendingBufferDownload = false;
                return;
            }

            ++this.buffersLoaded;

            this.buffers[arrayBufferIndex] = arrayBuffer;
            arrayBuffer.bufferIndex = bufferIndex; // which buffer in timeline is loaded into this arrayBuffer

            // so buffer knows which arrayBuffer contains its data... don't reference arrayBuffer directly because we only want to keep 3 arrayBuffers in memory at a time.
            buffer.arrayBufferIndex = arrayBufferIndex;
            buffer.loaded = true;
            this.pendingBufferDownload = false;
            this.needMeshData = false; // is this really true?

            this._startPlaybackIfReady();
            this._loadNextBuffer();

        }.bind(this));
    }

    _loadNextVideo() {

        if (this.freeVideoElements.length == 0) {
            return;
        }

        var videoElementIndex = this.freeVideoElements.shift();
        var video = this.videoElements[videoElementIndex];
        video.videoElementIndex = videoElementIndex;
        var videoIndex = this.nextVideoLoadIndex;
        var numVideos = this.json.extensions[HoloVideoObject._extName].timeline.length;
        this.nextVideoLoadIndex = (this.nextVideoLoadIndex + 1) % numVideos;
        var image = this.json.images[this.json.extensions[HoloVideoObject._extName].timeline[videoIndex].image];

        image.video = video;
        video.preloaded = false;

        video.autoplay = false;
        video.muted = this.openOptions.autoplay || !this.openOptions.audioEnabled;

        if (this.isSafari) {
            video.muted = true;
        }

        video.loop = numVideos == 1 && this.openOptions.autoloop;
        video.preload = "auto";
        video.crossOrigin = "true";
        video.playing = false;
        //video.timeOffset =  image.timeOffset;
        video.preloaded = false;

        var ext = image.uri.split('.').pop();

        var imageExt = image.extensions[HoloVideoObject._extName];

        if (this.isSafari && imageExt.hlsUri) {
            video.src = this.urlRoot + imageExt.hlsUri;
            video.mp4Name = imageExt.hlsUri;
        }

        else if (!this.isSafari && imageExt.dashUri && typeof dashjs != "undefined") {

            if (!this.dashPlayer) {
                this.dashPlayer = dashjs.MediaPlayer().create();
                this.dashPlayer.initialize();
            }

            var url = this.urlRoot + imageExt.dashUri;
            this.dashPlayer.attachView(video);
            this.dashPlayer.attachSource(url);

            video.mp4Name = imageExt.dashUri;
        }

        else {
            var url = this.urlRoot + image.uri;
            video.src = url;
            video.mp4Name = image.uri;
        }

        this._logInfo("loading video " + video.mp4Name);

        //video.getTime = function() {
        //  return Math.max((this.timeOffset + this.currentTime) * 1000 - 20, 0);
        //};

        var hvo = this;

        video.canplay = function() {
            this._logInfo("video -> canplay");
        }.bind(this);

        video.canplaythrough = function() {
            this._logInfo("video -> canplaythrough");
        }.bind(this);

        video.waiting = function() {
            this._logInfo("video -> waiting");
        }.bind(this);

        video.suspend = function() {
            this._logInfo("video -> suspend");
        }.bind(this);

        video.stalled = function() {
            this._logInfo("video -> stalled");
        }.bind(this);

        video.onerror = function(e) {    
            this._logInfo("video error: " + e.target.error.code + " - " + e.target.mp4Name);
        }.bind(this);

        video.onended = function () {
            video.playing = false;
            this._onVideoEnded(video);
        }.bind(this);

        if (this.isSafari) {
            video.onplaying = function() {

                video.pause();
                video.muted = this.openOptions.autoplay || !this.openOptions.audioEnabled;
                video.preloaded = true;
                this._logInfo("video loaded: " + video.mp4Name);

                video.onplaying = function () {
                    this._logInfo("video playing: " + video.mp4Name);
                    video.playing = true;
                }.bind(this);

                ++this.videosLoaded;
                this._startPlaybackIfReady();
                this._loadNextVideo();

            }.bind(this);
        }

        else {            
            video.onloadeddata = function () {

                var playPromise = video.play();

                if (playPromise !== undefined) {
                    // Automatic playback started!
                    playPromise.then(_ => {
                    })
                        .catch(error => {
                            // Auto-play was prevented
                            video.onplaying();
                        });
                }
            }.bind(this);

            video.onplaying = function() {

                video.pause();
                video.preloaded = true;
                this._logInfo("video loaded: " + video.mp4Name);

                video.onplaying = function () {
                    this._logInfo("video playing: " + video.mp4Name);
                    video.playing = true;
                }.bind(this);

                ++this.videosLoaded;
                this._startPlaybackIfReady();
                this._loadNextVideo();
            }.bind(this);
        }       

        // force preloading
        if (this.isSafari) {
            video.play();
        }
    }

    rewind() {
        if (this.json) {

            this._logInfo("rewind");

            var timeline = this.json.extensions[HoloVideoObject._extName].timeline;
            var image = this.json.images[timeline[this.currentVideoIndex].image];
            var currentVideo = image.video;
            currentVideo.pause();
            currentVideo.playing = false;
            currentVideo.currentTime = 0.0;

            this.state = HoloVideoObject.States.Opening;

            this.freeArrayBuffers = [];
            for (var i = 0 ; i < Math.min(3, this.json.buffers.length - 1) ; ++i) {
                this.freeArrayBuffers.push(i);
            }

            this.currentBufferIndex = 0;
            this.nextBufferLoadIndex = this.fallbackFrameBuffer ? 1 : 0;
            this.frameIndex = -1;
            this.nextPbo = 0;
            this.lastVideoSampleIndex = -1;
            this.filledFallbackFrame = false;
            this.curMesh = null;
            this.prevMesh = null;
            this.prevPrevMesh = null;

            if (this.readFences) {
                for (var i = 0 ; i < this.readFences.length ; ++i) {
                    if (this.readFences[i]) {
                        this.gl.deleteSync(this.readFences[i]);
                        this.readFences[i] = null;
                    }
                }
            }

            this._loadNextBuffer();
            this._loadFallbackFrame();
        }
    }

    forceLoad() {
        if (this.json) {
            var timeline = this.json.extensions[HoloVideoObject._extName].timeline;
            var image = this.json.images[timeline[this.currentVideoIndex].image];
            var currentVideo = image.video;

            if (currentVideo.playing) {
                this._logInfo("forceLoad: video already playing");
            }

            else if (!currentVideo.preloaded) {
                this._logInfo("forceLoad: manually starting video");
                this.suspended = true;
                var playPromise = currentVideo.play();

                if (playPromise !== undefined) {
                    playPromise.then(_ => {
                        this.state = HoloVideoObject.States.Playing;
                    })
                        .catch(error => {
                            // Auto-play was prevented
                            this._logInfo("play prevented: " + error);
                        });
                }
            }
        }

        else {
            this._logInfo("forceLoad: don't have json yet");
        }
    }

    _onVideoEnded(video) {
        this._logInfo("video ended = " + video.mp4Name);
        this.freeVideoElements.push(video.videoElementIndex);
        video.videoElementIndex = -1;
        var timeline = this.json.extensions[HoloVideoObject._extName].timeline;

        if (this.currentVideoIndex == timeline.length - 1 && !this.openOptions.autoloop) {
            this.eos = true;
            if (this.onEndOfStream) {
                this.onEndOfStream(this);
            }
        }

        else {
            this.currentVideoIndex = (this.currentVideoIndex + 1) % timeline.length;
            this._loadNextVideo();
            this._startPlaybackIfReady();
        }
    }

    _setupTransformFeedback() {

        var gl = this.gl;

        this.outputBufferIndex = 0;
        this.deltasBuf = gl.createBuffer();
        this.outputBuffers = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];
        this.transformFeedbacks = [gl.createTransformFeedback(), gl.createTransformFeedback(), gl.createTransformFeedback()];
        this.vaos = [gl.createVertexArray(), gl.createVertexArray(), gl.createVertexArray()];

        gl.bindVertexArray(null);

        for (var i = 0 ; i < 3 ; ++i) {
            gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.transformFeedbacks[i]);
            gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.outputBuffers[i]);
        }

        this.normalsVao = gl.createVertexArray();
        //this.decodedNormals = gl.createBuffer();
        this.normalsTF = gl.createTransformFeedback();
        //gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.normalsTF);
        //gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.decodedNormals);

        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
        gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);

        var tfShaderSourcePS = `#version 300 es
            out lowp vec4 fragColor;
            void main()
            {
                fragColor = vec4(0,0,0,0);
            }
            `;

        var tfShaderSourceVS = `#version 300 es
            in vec3 inQuantized;
            in vec3 prevPos;
            in vec3 prevPrevPos;

            uniform vec3 decodeMin;
            uniform vec3 decodeMax;
            uniform int havePrevPos;
            uniform int havePrevPrevPos;

            out vec3 outPos;

            void main()
            {
                if (havePrevPos == 1)
                {
                    vec3 dm = vec3(0.0, 0.0, 0.0);

                    if (havePrevPrevPos == 1)
                    {
                        dm = prevPos - prevPrevPos;
                    }

                    vec3 delta = (decodeMax - decodeMin) * inQuantized + decodeMin;
                    outPos = prevPos + dm + delta;
                }

                else
                {
                    outPos = (decodeMax - decodeMin) * inQuantized + decodeMin;
                }
            }`;

        var tfShader = this._createProgram(gl, tfShaderSourceVS, tfShaderSourcePS, function (program) {
            gl.transformFeedbackVaryings(program, ["outPos"], gl.SEPARATE_ATTRIBS);
        });

        tfShader.havePrevPosLoc = gl.getUniformLocation(tfShader, "havePrevPos");
        tfShader.havePrevPrevPosLoc = gl.getUniformLocation(tfShader, "havePrevPrevPos");
        tfShader.decodeMinLoc = gl.getUniformLocation(tfShader, "decodeMin");
        tfShader.decodeMaxLoc = gl.getUniformLocation(tfShader, "decodeMax");
        tfShader.inQuantizedLoc = gl.getAttribLocation(tfShader, "inQuantized");
        tfShader.prevPosLoc = gl.getAttribLocation(tfShader, "prevPos");
        tfShader.prevPrevPosLoc = gl.getAttribLocation(tfShader, "prevPrevPos");
        this.tfShader = tfShader;

        var octNormalsShaderSourceVS = `#version 300 es
            in vec2 inOctNormal;
            out vec3 outNormal;

            vec3 OctDecode(vec2 f)
            {
                f = f * 2.0 - 1.0;

                // https://twitter.com/Stubbesaurus/status/937994790553227264
                vec3 n = vec3( f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
                float t = clamp(-n.z, 0.0, 1.0);
                n.x += n.x >= 0.0 ? -t : t;
                n.y += n.y >= 0.0 ? -t : t;
                return normalize(n);
            }

            void main()
            {
                outNormal = OctDecode(inOctNormal);
            }`

        var octNormalsShader = this._createProgram(gl, octNormalsShaderSourceVS, tfShaderSourcePS, function (program) {
            gl.transformFeedbackVaryings(program, ["outNormal"], gl.SEPARATE_ATTRIBS);
        });

        octNormalsShader.inOctNormalLoc = gl.getAttribLocation(octNormalsShader, "inOctNormal");
        this.octNormalsShader = octNormalsShader;
    }

    _updateMeshTF(frame, posBuf, uvBuf, indexBuf, norBuf, sourceBuffers) {

        var gl = this.gl;

        // this is the buffer we're capturing to with transform feedback
        frame.outputBuffer = this.outputBuffers[this.outputBufferIndex];

        var saveVb = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
        var saveIb = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
        var saveShader = gl.getParameter(gl.CURRENT_PROGRAM);

        gl.useProgram(this.tfShader);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        var vertexCount = 0;
        var tfShader = this.tfShader;

        if (frame.primitives[0].extensions[HoloVideoObject._extName].attributes.POSITION) {

            // copy indices
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sourceBuffers.indices, gl.STATIC_DRAW);

            // copy uvs
            gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
            gl.bufferData(gl.ARRAY_BUFFER, sourceBuffers.compressedUVs, gl.STATIC_DRAW);

            gl.bindVertexArray(this.vaos[0]);

            this.prevMesh = null;
            this.prevPrevMesh = null;
            vertexCount = frame.compressedPos.count;
            frame.indexCount = frame.indices.count;

            // copy compressed (quantized) positions
            gl.bindBuffer(gl.ARRAY_BUFFER, this.deltasBuf);
            gl.bufferData(gl.ARRAY_BUFFER, sourceBuffers.compressedPos, gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(tfShader.inQuantizedLoc);
            gl.vertexAttribPointer(tfShader.inQuantizedLoc, 3, frame.compressedPos.componentType, true, 0, 0);

            gl.disableVertexAttribArray(tfShader.prevPosLoc);
            gl.disableVertexAttribArray(tfShader.prevPrevPosLoc);

            var min = frame.compressedPos.extensions[HoloVideoObject._extName].decodeMin;
            var max = frame.compressedPos.extensions[HoloVideoObject._extName].decodeMax;

            gl.uniform3fv(tfShader.decodeMinLoc, min);
            gl.uniform3fv(tfShader.decodeMaxLoc, max);

            this.currentFrameInfo.bboxMin = min;
            this.currentFrameInfo.bboxMax = max;

            gl.uniform1i(tfShader.havePrevPosLoc, 0);
            gl.uniform1i(tfShader.havePrevPrevPosLoc, 0);            
        }

        else {

            vertexCount = frame.deltas.count;
            frame.indexCount = this.prevMesh.indexCount;

            if (this.prevPrevMesh == null) {
                gl.bindVertexArray(this.vaos[1]);
            }

            else {
                gl.bindVertexArray(this.vaos[2]);
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, this.deltasBuf);
            gl.bufferData(gl.ARRAY_BUFFER, sourceBuffers.deltas, gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(tfShader.inQuantizedLoc);
            gl.vertexAttribPointer(tfShader.inQuantizedLoc, 3, frame.deltas.componentType, true, 0, 0);

            gl.uniform3fv(tfShader.decodeMinLoc, frame.deltas.extensions[HoloVideoObject._extName].decodeMin);
            gl.uniform3fv(tfShader.decodeMaxLoc, frame.deltas.extensions[HoloVideoObject._extName].decodeMax);

            gl.uniform1i(tfShader.havePrevPosLoc, 1);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.prevMesh.outputBuffer);
            gl.enableVertexAttribArray(tfShader.prevPosLoc);
            gl.vertexAttribPointer(tfShader.prevPosLoc, 3, gl.FLOAT, false, 0, 0);

            if (this.prevPrevMesh == null) {
                gl.uniform1i(tfShader.havePrevPrevPosLoc, 0);
                gl.disableVertexAttribArray(tfShader.prevPrevPosLoc);
            }

            else {
                gl.uniform1i(tfShader.havePrevPrevPosLoc, 1);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.prevPrevMesh.outputBuffer);
                gl.enableVertexAttribArray(tfShader.prevPrevPosLoc);
                gl.vertexAttribPointer(tfShader.prevPrevPosLoc, 3, gl.FLOAT, false, 0, 0);
            }
        }

        // ensure output buffer has enough capacity
        var bufferSize = vertexCount * 12;
        gl.bindBuffer(gl.ARRAY_BUFFER, frame.outputBuffer);
        //gl.bufferData(gl.ARRAY_BUFFER, bufferSize, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.transformFeedbacks[this.outputBufferIndex]);
        gl.enable(gl.RASTERIZER_DISCARD);
        gl.beginTransformFeedback(gl.POINTS);
        gl.drawArrays(gl.POINTS, 0, vertexCount);
        gl.endTransformFeedback();
        gl.disable(gl.RASTERIZER_DISCARD);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
        gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);

        //gl.getError();

        gl.bindVertexArray(null);

        // copy captured output into 'posBuf' passed to us by caller.
        gl.bindBuffer(gl.COPY_READ_BUFFER, frame.outputBuffer);
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, posBuf);
        gl.bufferData(gl.COPY_WRITE_BUFFER, bufferSize, gl.DYNAMIC_COPY);
        gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, bufferSize);
        gl.bindBuffer(gl.COPY_READ_BUFFER, null);
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);

        this.outputBufferIndex = (this.outputBufferIndex + 1) % 3;

        // copy normals, if any
        if (norBuf && sourceBuffers.compressedNormals) {

            //debugger;

            if (this.fileInfo.octEncodedNormals) {

                gl.useProgram(this.octNormalsShader);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);

                gl.bindVertexArray(this.normalsVao);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.deltasBuf); // using deltasBuf as a scratch buffer
                gl.bufferData(gl.ARRAY_BUFFER, sourceBuffers.compressedNormals, gl.DYNAMIC_DRAW);
                gl.enableVertexAttribArray(this.octNormalsShader.inOctNormalLoc);
                gl.vertexAttribPointer(this.octNormalsShader.inOctNormalLoc, 2, gl.UNSIGNED_BYTE, true, 0, 0);

                var bufferSize = vertexCount * 12;
                gl.bindBuffer(gl.ARRAY_BUFFER, norBuf);
                gl.bufferData(gl.ARRAY_BUFFER, bufferSize, gl.DYNAMIC_DRAW);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);

                gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.normalsTF);
                gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, norBuf);
                gl.enable(gl.RASTERIZER_DISCARD);
                gl.beginTransformFeedback(gl.POINTS);
                gl.drawArrays(gl.POINTS, 0, vertexCount);
                gl.endTransformFeedback();
                gl.disable(gl.RASTERIZER_DISCARD);
                gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
                gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);

                gl.bindVertexArray(null);

                //gl.bindBuffer(gl.COPY_READ_BUFFER, norBuf);
                //gl.bindBuffer(gl.COPY_WRITE_BUFFER, norBuf);
                //gl.bufferData(gl.COPY_WRITE_BUFFER, bufferSize, gl.DYNAMIC_COPY);
                //gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, bufferSize);
                //gl.bindBuffer(gl.COPY_READ_BUFFER, null);
                //gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
            }

            else {
                gl.bindBuffer(gl.ARRAY_BUFFER, norBuf);
                gl.bufferData(gl.ARRAY_BUFFER, sourceBuffers.compressedNormals, gl.DYNAMIC_DRAW);
            }
        }

        gl.useProgram(saveShader);
        gl.bindBuffer(gl.ARRAY_BUFFER, saveVb);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, saveIb);

        return true;
    }   

    _updateMesh(posBuf, uvBuf, indexBuf, norBuf) {

        this.frameIndex = (this.frameIndex + 1) % this.meshFrames.length;

        var frame = this.meshFrames[this.frameIndex];

        if (!frame.ensureBuffers()) {
            return false;
        }

        if (this.prevPrevMesh) {
            this.prevPrevMesh.uncompressedPos = null;
        }

        this.prevPrevMesh = this.prevMesh;
        this.prevMesh = this.curMesh;
        this.curMesh = frame;

        var sourceBuffers = {
            indices : null,
            compressedPos : null,
            compressedUVs : null,
            compressedNormals : null,
            deltas : null
        };

        var buffers = this.json.buffers;
        var bufferViews = this.json.bufferViews;

        var attributes = frame.primitives[0].extensions[HoloVideoObject._extName].attributes;
        var arrayBufferIndex = -1;

        if (attributes.POSITION) {
            arrayBufferIndex = buffers[bufferViews[frame.indices.bufferView].buffer].arrayBufferIndex;            
            var indexArrayBuf = this.buffers[arrayBufferIndex];
            var posArrayBuf = this.buffers[arrayBufferIndex];
            var uvArrayBuf = this.buffers[arrayBufferIndex];
            sourceBuffers.indices = new Uint16Array(indexArrayBuf, bufferViews[frame.indices.bufferView].byteOffset + frame.indices.byteOffset, frame.indices.count);
            sourceBuffers.compressedPos = new Uint16Array(posArrayBuf, bufferViews[frame.compressedPos.bufferView].byteOffset + frame.compressedPos.byteOffset, frame.compressedPos.count * 3);
            sourceBuffers.compressedUVs = new Uint16Array(uvArrayBuf, bufferViews[frame.compressedUVs.bufferView].byteOffset + frame.compressedUVs.byteOffset, frame.compressedUVs.count * 2);
        }
        else {
            arrayBufferIndex = buffers[bufferViews[frame.deltas.bufferView].buffer].arrayBufferIndex;
            var deltasArrayBuf = this.buffers[arrayBufferIndex];
            sourceBuffers.deltas = new Uint8Array(deltasArrayBuf, bufferViews[frame.deltas.bufferView].byteOffset + frame.deltas.byteOffset, frame.deltas.count * 3);
        }

        if (arrayBufferIndex != this.currentBufferIndex) {
            this._logInfo("currentBufferIndex -> " + arrayBufferIndex);
            this.freeArrayBuffers.push(this.currentBufferIndex);
            this.currentBufferIndex = arrayBufferIndex;
            if (!this.pendingBufferDownload) {
                this._loadNextBuffer();
            }
        }

        if (frame.compressedNormals != null) {

            var norArrayBuf = this.buffers[buffers[bufferViews[frame.compressedNormals.bufferView].buffer].arrayBufferIndex];

            // oct encoding
            if (frame.compressedNormals.type == "VEC2") {
                sourceBuffers.compressedNormals = new Uint8Array(norArrayBuf, bufferViews[frame.compressedNormals.bufferView].byteOffset + frame.compressedNormals.byteOffset, frame.compressedNormals.count * 2);
            }
            // quantized 16-bit xyz
            else if (frame.compressedNormals.type == "VEC3") {
                sourceBuffers.compressedNormals = new Uint16Array(norArrayBuf, bufferViews[frame.compressedNormals.bufferView].byteOffset + frame.compressedNormals.byteOffset, frame.compressedNormals.count * 3);
            }
        }

        if (this.caps.webgl2 && !this.caps.badTF) {
            return this._updateMeshTF(frame, posBuf, uvBuf, indexBuf, norBuf, sourceBuffers);
        }

        var gl = this.gl;

        var saveVb = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
        var saveIb = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);

        // keyframe
        if (frame.primitives[0].extensions[HoloVideoObject._extName].attributes.POSITION) {

            if (this.prevMesh) {
                this.prevMesh.uncompressedPos = null;
                this.prevMesh = null;
            }

            if (this.prevPrevMesh) {
                this.prevPrevMesh.uncompressedPos = null;
                this.prevPrevMesh = null;
            }

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sourceBuffers.indices, gl.DYNAMIC_DRAW);

            frame.indexCount = frame.indices.count;

            {
                var count = frame.compressedPos.count;

                frame.uncompressedPos = new Float32Array(count * 3); // need to keep these around to decode next frame.

                var min = frame.compressedPos.extensions[HoloVideoObject._extName].decodeMin;
                var max = frame.compressedPos.extensions[HoloVideoObject._extName].decodeMax;

                this.currentFrameInfo.bboxMin = min;
                this.currentFrameInfo.bboxMax = max;

                var bboxdx = (max[0] - min[0]) / 65535.0;
                var bboxdy = (max[1] - min[1]) / 65535.0;
                var bboxdz = (max[2] - min[2]) / 65535.0;
                for (var i = 0; i < count; ++i) {
                    var i0 = 3*i;
                    var i1 = i0 + 1;
                    var i2 = i0 + 2;
                    frame.uncompressedPos[i0] = sourceBuffers.compressedPos[i0] * bboxdx + min[0];
                    frame.uncompressedPos[i1] = sourceBuffers.compressedPos[i1] * bboxdy + min[1];
                    frame.uncompressedPos[i2] = sourceBuffers.compressedPos[i2] * bboxdz + min[2];
                }

                gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
                gl.bufferData(gl.ARRAY_BUFFER, frame.uncompressedPos, gl.DYNAMIC_DRAW);
            }

            //if (true) {
            // don't need to un-quantized values we'll tell glVertexAttribPointer to do it
            gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
            gl.bufferData(gl.ARRAY_BUFFER, sourceBuffers.compressedUVs, gl.DYNAMIC_DRAW);
            //}
        }

        else {

            var count = frame.deltas.count;

            frame.uncompressedPos = new Float32Array(count * 3);
            frame.indexCount = this.prevMesh.indexCount;

            var min = frame.deltas.extensions[HoloVideoObject._extName].decodeMin;
            var max = frame.deltas.extensions[HoloVideoObject._extName].decodeMax;
            var bboxdx = (max[0] - min[0]) / 255.0;
            var bboxdy = (max[1] - min[1]) / 255.0;
            var bboxdz = (max[2] - min[2]) / 255.0;

            var deltas = sourceBuffers.deltas;

            if (this.prevPrevMesh == null) {
                for (var i = 0; i < count; ++i) {
                    var i0 = 3*i;
                    var i1 = i0 + 1;
                    var i2 = i0 + 2;

                    var x = this.prevMesh.uncompressedPos[i0];
                    var y = this.prevMesh.uncompressedPos[i1];
                    var z = this.prevMesh.uncompressedPos[i2];

                    var deltaX = deltas[i0] * bboxdx + min[0];
                    var deltaY = deltas[i1] * bboxdy + min[1];
                    var deltaZ = deltas[i2] * bboxdz + min[2];

                    // final
                    x += deltaX;
                    y += deltaY;
                    z += deltaZ;

                    frame.uncompressedPos[i0] = x;
                    frame.uncompressedPos[i1] = y;
                    frame.uncompressedPos[i2] = z;
                }
            }
            else {
                for (var i = 0; i < count; ++i) {

                    var i0 = 3*i;
                    var i1 = i0 + 1;
                    var i2 = i0 + 2;

                    var x = this.prevMesh.uncompressedPos[i0];
                    var y = this.prevMesh.uncompressedPos[i1];
                    var z = this.prevMesh.uncompressedPos[i2];

                    var dx = x - this.prevPrevMesh.uncompressedPos[i0];
                    var dy = y - this.prevPrevMesh.uncompressedPos[i1];
                    var dz = z - this.prevPrevMesh.uncompressedPos[i2];

                    // predicted
                    x += dx;
                    y += dy;
                    z += dz;

                    var deltaX = deltas[i0] * bboxdx + min[0];
                    var deltaY = deltas[i1] * bboxdy + min[1];
                    var deltaZ = deltas[i2] * bboxdz + min[2];

                    // final
                    x += deltaX;
                    y += deltaY;
                    z += deltaZ;

                    frame.uncompressedPos[i0] = x;
                    frame.uncompressedPos[i1] = y;
                    frame.uncompressedPos[i2] = z;
                }
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
            gl.bufferData(gl.ARRAY_BUFFER, frame.uncompressedPos, gl.DYNAMIC_DRAW);    
        }

        // copy normals, if any
        if (norBuf && sourceBuffers.compressedNormals) {

            //debugger;

            /*
            _OctDecode(vec2 f)
            {
                f = f * 2.0 - 1.0;

                // https://twitter.com/Stubbesaurus/status/937994790553227264
                vec3 n = vec3( f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
                float t = clamp(-n.z, 0.0, 1.0);
                n.x += n.x >= 0.0 ? -t : t;
                n.y += n.y >= 0.0 ? -t : t;
                return normalize(n);
            }
            */

                if (this.fileInfo.octEncodedNormals) {
                    var count = sourceBuffers.compressedNormals.length;
                    var uncompressedNormals = new Float32Array(3 * count);
                    var abs = Math.abs;
                    var clamp = this._clamp;
                    var sqrt = Math.sqrt;
                    for (var i = 0 ; i < count ; ++i) {
                        var x = sourceBuffers.compressedNormals[2*i];
                        var y = sourceBuffers.compressedNormals[2*i+1];
                        x = -1.0 + x * 0.0078125;
                        y = -1.0 + y * 0.0078125;
                        var z = 1.0 - abs(x) - abs(y);
                        var t = clamp(-z, 0.0, 1.0);
                        x += x >= 0.0 ? -t : t;
                        y += y >= 0.0 ? -t : t;
                        var invLen = 1.0 / Math.sqrt(x * x + y * y + z * z);
                        uncompressedNormals[3*i] = x * invLen;
                        uncompressedNormals[3*i+1] = y * invLen;
                        uncompressedNormals[3*i+2] = z * invLen;
                    }
                    gl.bindBuffer(gl.ARRAY_BUFFER, norBuf);
                    gl.bufferData(gl.ARRAY_BUFFER, uncompressedNormals, gl.DYNAMIC_DRAW);
                }

            else {
                gl.bindBuffer(gl.ARRAY_BUFFER, norBuf);
                gl.bufferData(gl.ARRAY_BUFFER, sourceBuffers.compressedNormals, gl.DYNAMIC_DRAW);
            }
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, saveVb);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, saveIb);

        return true;
    }

    _clamp(num, min, max) {
        return num < min ? min : num > max ? max : num;
    }

    _onJsonLoaded(response) {

        this._logInfo("got json");

        var json = this.json = JSON.parse(response);

        this.minBuffers = Math.min(2, this.json.buffers.length - 1);
        var timeline = this.json.extensions[HoloVideoObject._extName].timeline;
        this.minVideos = Math.min(2, timeline.length);

        this.buffers = [null, null, null];
        this.videoElements = [document.createElement('video')];//, document.createElement('video'), document.createElement('video')];

        this.videoElements[0].setAttribute('playsinline', 'playsinline');
        //this.videoElements[1].setAttribute('playsinline', 'playsinline');
        //this.videoElements[2].setAttribute('playsinline', 'playsinline');

        this.videoElements[0].volume = this.audioVolume;

        //for (var i = 0 ; i < Math.min(3, timeline.length) ; ++i) {
        this.freeVideoElements.push(0);
        //}

        for (var i = 0 ; i < Math.min(3, this.json.buffers.length - 1) ; ++i) {
            this.freeArrayBuffers.push(i);
        }

        this._loadNextVideo();
        this._loadNextBuffer();
        this.currentBufferIndex = 0; // this is index into our ring of 3 buffers we keep in memory at a time, not full capture buffers list

        var accessors = this.json.accessors;
        var numFrames = this.json.meshes.length;

        var arrayBuffers = this.buffers;

        var hvo = this;

        var ensureBuffers = function() {
            var bufferViews = json.bufferViews;
            var buffers = json.buffers;

            if (this.primitives[0].extensions[HoloVideoObject._extName].attributes.POSITION) {

                var indexBufferView = bufferViews[this.indices.bufferView];
                if (buffers[indexBufferView.buffer].arrayBufferIndex == undefined ||
                    arrayBuffers[buffers[indexBufferView.buffer].arrayBufferIndex].bufferIndex != indexBufferView.buffer) {
                    hvo._logInfo("buffer for frame " + this.frameIndex + " not downloaded yet: " + buffers[indexBufferView.buffer].uri);
                    return false;
                }

                var posBufferView = bufferViews[this.compressedPos.bufferView];
                if (buffers[posBufferView.buffer].arrayBufferIndex == undefined ||
                    arrayBuffers[buffers[posBufferView.buffer].arrayBufferIndex].bufferIndex != posBufferView.buffer) {
                    hvo._logInfo("buffer for frame " + this.frameIndex + " not downloaded yet: " + buffers[posBufferView.buffer].uri);
                    return false;
                }

                var uvBufferView = bufferViews[this.compressedUVs.bufferView];
                if (buffers[uvBufferView.buffer].arrayBufferIndex == undefined ||
                    arrayBuffers[buffers[uvBufferView.buffer].arrayBufferIndex].bufferIndex != uvBufferView.buffer) {
                    hvo._logInfo("buffer for frame " + this.frameIndex + " not downloaded yet: " + buffers[uvBufferView.buffer].uri);
                    return false;
                }
            }
            else {

                var deltaBufferView = bufferViews[this.deltas.bufferView];
                if (buffers[deltaBufferView.buffer].arrayBufferIndex == undefined ||
                    arrayBuffers[buffers[deltaBufferView.buffer].arrayBufferIndex].bufferIndex != deltaBufferView.buffer) {
                    hvo._logInfo("buffer for frame " + this.frameIndex + " not downloaded yet: " + buffers[deltaBufferView.buffer].uri);
                    return false;
                }
            }

            if (this.compressedNormals) {
                var norBufferView = bufferViews[this.compressedNormals.bufferView];
                if (buffers[norBufferView.buffer].arrayBufferIndex == undefined ||
                    arrayBuffers[buffers[norBufferView.buffer].arrayBufferIndex].bufferIndex != norBufferView.buffer) {
                    hvo._logInfo("buffer for frame " + this.frameIndex + " not downloaded yet: " + buffers[norBufferView.buffer].uri);
                    return false;
                }
            }

            return true;
        }

        for (var i = 0; i < numFrames; ++i) {

            var meshFrame = this.json.meshes[i];
            meshFrame.frameIndex = i;
            meshFrame.ensureBuffers = ensureBuffers;

            var attributes = meshFrame.primitives[0].extensions[HoloVideoObject._extName].attributes;

            if (attributes.POSITION) {
                // accessor offset is relative to bufferView, not buffer
                meshFrame.indices = accessors[meshFrame.primitives[0].extensions[HoloVideoObject._extName].indices];
                meshFrame.compressedUVs = accessors[attributes.TEXCOORD_0];
                meshFrame.compressedPos = accessors[attributes.POSITION];
            }

            else {
                meshFrame.deltas = accessors[attributes._DELTA];
            }

            if (attributes.NORMAL != null) {
                this.fileInfo.haveNormals = true;
                meshFrame.compressedNormals = accessors[attributes.NORMAL];

                if (meshFrame.compressedNormals.type == "VEC2") {
                    this.fileInfo.octEncodedNormals = true;
                }
            }

            this.meshFrames.push(meshFrame);
        }

        var image = this.json.images[1].extensions[HoloVideoObject._extName];

        this.fileInfo.videoWidth = image.width;
        this.fileInfo.videoHeight = image.height;

        var ext = this.json.extensions[HoloVideoObject._extName];

        this.fileInfo.maxVertexCount = ext.maxVertexCount;
        this.fileInfo.maxIndexCount = ext.maxIndexCount;

        this.fileInfo.boundingBox = {
            "min": ext.boundingMin,
            "max": ext.boundingMax
        };

        if (this.onLoaded) {
            this.onLoaded(this.fileInfo);
        }

        if (this.outputBuffers) {

            var gl = this.gl;

            var saveVb = gl.getParameter(gl.ARRAY_BUFFER_BINDING);

            for (var i = 0 ; i < 3 ; ++i) {
                gl.bindBuffer(gl.ARRAY_BUFFER, this.outputBuffers[i]);
                gl.bufferData(gl.ARRAY_BUFFER, 12 * ext.maxVertexCount, gl.STREAM_COPY);
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, saveVb);
        }
    }

    _getChromeVersion () {
        var raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
        return raw ? parseInt(raw[2], 10) : false;
    }

    // public APIs begin here:

    _logInfo(message, force) {
        if (this.logLevel >= 2 || force) {
            var id = this.id;
            console.log(`[${id}] ` + message);
        }
    }

    _logWarning(message) {
        if (this.logLevel >= 1) {
            var id = this.id;
            console.log(`[${id}] ` + message);
        }
    }

    _logError(message) {
        if (this.logLevel >= 0) {
            var id = this.id;
            console.log(`[${id}] ` + message);
        }
    }

    constructor(gl) {

        this.id = HoloVideoObject._instanceCounter++;
        this.state = HoloVideoObject.States.Empty;
        this.suspended = false;
        this.gl = gl;
        this.logLevel = 0;
        this.audioVolume = 1.0;

        document.addEventListener('visibilitychange', function() {
            if (document.hidden) {
                this.wasPlaying = this.state == HoloVideoObject.States.Playing;
                this._logInfo("document hidden -> pausing playback");
                this.pause();
            }

            else if (this.wasPlaying)
            {
                this.wasPlaying = false;
                this._logInfo("document visible -> resuming playback");
                this.play();
            }
        }.bind(this));

        var caps = {};

        var version = gl.getParameter(gl.VERSION);
        alert(`GL version: ${version}`)
        caps.webgl2 = version.indexOf("WebGL 2.") != -1;
        alert(`caps.webgl2: ${caps.webgl2}`)
        caps.badTF = false;

        this.isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

        var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');

        if (debugInfo) {
            caps.vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
            caps.renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);

            if (caps.renderer.indexOf("Mali") != -1) {
                //var chromeVersion = this._getChromeVersion();
                // if this gets fixed at some point we'd want to check for a minimum chrome/driver version here
                caps.badTF = true;
            }
        }

        var capsStr = JSON.stringify(caps, null, 4);
        this._logInfo(capsStr, true);

        //var ua = window.navigator.userAgent;
        //var iOS = !!ua.match(/iPad/i) || !!ua.match(/iPhone/i);
        //var webkit = !!ua.match(/WebKit/i);
        //var iOSSafari = iOS && webkit && !ua.match(/CriOS/i);
        //var isFirefox = typeof InstallTrigger !== 'undefined';

        this.fbo1 = gl.createFramebuffer();

        if (caps.webgl2) {

            if (!caps.badTF) {
                this._setupTransformFeedback();
            }

            this.fbo2 = gl.createFramebuffer();
            this.textures = [null, null, null];
            this.pixelBuffers = [null, null, null];
            this.readFences = [null, null, null];
            this.nextPbo = 0;
        }

        else
        {
            this.textures = [null];
        }

        var saveTex = gl.getParameter(gl.TEXTURE_BINDING_2D);

        for (var i = 0 ; i < (caps.webgl2 ? this.textures.length : 1) ; ++i) {
            this.textures[i] = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }

        gl.bindTexture(gl.TEXTURE_2D, saveTex);

        this.caps = caps;
    }

    getLoadProgress() {

        if (this.minBuffers == undefined) {
            return 0;
        }

        if (this.state >= HoloVideoObject.States.Opened) {
            return 1.0;
        }

        return (this.buffersLoaded + this.videosLoaded) / (this.minBuffers + this.minVideos);
    }

    setBuffers(posBuf, indexBuf, uvBuf, norBuf, tex) {
        var clientBuffers = {};
        clientBuffers.posBuf = posBuf;
        clientBuffers.indexBuf = indexBuf;
        clientBuffers.uvBuf = uvBuf;
        clientBuffers.norBuf = norBuf;
        clientBuffers.tex = tex;
        this.clientBuffers = clientBuffers;
    }

    _loadFallbackFrame() {
        if (this.json && this.fallbackFrameBuffer) {
            if (!this.fallbackTextureImage) {
                this.fallbackTextureImage = new Image();

                var encode = function(input) {
                    var keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
                    var output = "";
                    var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
                    var i = 0;

                    while (i < input.length) {
                        chr1 = input[i++];
                        chr2 = i < input.length ? input[i++] : Number.NaN; // Not sure if the index 
                        chr3 = i < input.length ? input[i++] : Number.NaN; // checks are needed here

                        enc1 = chr1 >> 2;
                        enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
                        enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
                        enc4 = chr3 & 63;

                        if (isNaN(chr2)) {
                            enc3 = enc4 = 64;
                        } else if (isNaN(chr3)) {
                            enc4 = 64;
                        }
                        output += keyStr.charAt(enc1) + keyStr.charAt(enc2) +
                            keyStr.charAt(enc3) + keyStr.charAt(enc4);
                    }
                    return output;
                }

                // FIXME? can we always assume fallback image is image 0?
                var fallbackImage = this.json.images[0];
                var bufferView = this.json.bufferViews[fallbackImage.bufferView];

                this.fallbackTextureImage.src = 'data:image/jpeg;base64,'+ encode(new Uint8Array(this.fallbackFrameBuffer, bufferView.byteOffset, bufferView.byteLength));

                this.fallbackTextureImage.onload = function() {
                    this._logInfo("fallback image loaded");
                    this.fallbackTextureImage.loaded = true;
                }.bind(this);
            }

            if (this.fallbackTextureImage && 
                this.fallbackTextureImage.loaded && 
                !this.filledFallbackFrame &&
                this.clientBuffers && 
                this.clientBuffers.posBuf) {

                var gl = this.gl;

                var fallbackPrim = this.json.meshes[0].primitives[0];

                var saveVb = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
                var saveIb = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);

                var posAccesor = this.json.accessors[fallbackPrim.attributes.POSITION];
                var posBufferView = this.json.bufferViews[posAccesor.bufferView];
                gl.bindBuffer(gl.ARRAY_BUFFER, this.clientBuffers.posBuf);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.fallbackFrameBuffer, posBufferView.byteOffset + posAccesor.byteOffset, posAccesor.count * 3), gl.STATIC_DRAW);

                if (this.clientBuffers.norBuf && this.fileInfo.haveNormals) {
                    var norAccesor = this.json.accessors[fallbackPrim.attributes.NORMAL];
                    var norBufferView = this.json.bufferViews[norAccesor.bufferView];

                    gl.bindBuffer(gl.ARRAY_BUFFER, this.clientBuffers.norBuf);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.fallbackFrameBuffer, norBufferView.byteOffset + norAccesor.byteOffset, norAccesor.count * 3), gl.STATIC_DRAW);
                }

                var uvAccesor = this.json.accessors[fallbackPrim.attributes.TEXCOORD_0];
                var uvBufferView = this.json.bufferViews[uvAccesor.bufferView];
                gl.bindBuffer(gl.ARRAY_BUFFER, this.clientBuffers.uvBuf);
                gl.bufferData(gl.ARRAY_BUFFER, new Uint16Array(this.fallbackFrameBuffer, uvBufferView.byteOffset + uvAccesor.byteOffset, uvAccesor.count * 2), gl.STATIC_DRAW);

                var indexAccessor = this.json.accessors[fallbackPrim.indices];
                var indexBufferView = this.json.bufferViews[indexAccessor.bufferView];
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.clientBuffers.indexBuf);
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(this.fallbackFrameBuffer, indexBufferView.byteOffset + indexAccessor.byteOffset, indexAccessor.count), gl.STATIC_DRAW);

                gl.bindBuffer(gl.ARRAY_BUFFER, saveVb);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, saveIb);

                var saveTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
                gl.bindTexture(gl.TEXTURE_2D, this.clientBuffers.tex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.fallbackTextureImage);
                gl.bindTexture(gl.TEXTURE_2D, saveTex);

                this.currentFrameInfo.primCount = indexAccessor.count;

                posAccesor = this.json.accessors[fallbackPrim.extensions[HoloVideoObject._extName].attributes.POSITION];
                var min = posAccesor.extensions[HoloVideoObject._extName].decodeMin;
                var max = posAccesor.extensions[HoloVideoObject._extName].decodeMax;
                this.currentFrameInfo.bboxMin = min;
                this.currentFrameInfo.bboxMax = max;

                this.filledFallbackFrame = true;
                // keeping these around for rewind:
                //this.fallbackTextureImage = null;
                //this.fallbackFrameBuffer = null;
            }

            return this.filledFallbackFrame;
        }
    }

    updateBuffers() {

        if (!this.filledFallbackFrame) {
            return this._loadFallbackFrame();
        }

        var timeline = this.json.extensions[HoloVideoObject._extName].timeline;
        var image = this.json.images[timeline[this.currentVideoIndex].image];
        var currentVideo = image.video;

        if (!this.needMeshData &&
            currentVideo && 
            currentVideo.playing && 
            this.suspended && currentVideo.readyState == 4) {
            this._logInfo("updateBuffers resuming stalled video");
            currentVideo.play();
            this.suspended = false;
        }

        if (currentVideo && currentVideo.playing && !this.suspended) {

            if (currentVideo.readyState != 4) {
                this._logInfo("suspending currentVideo.readyState -> " + currentVideo.readyState)
                currentVideo.pause();
                this.suspended = true;
            }

            var now = window.performance.now();
            var videoNow = currentVideo.currentTime * 1000;

            if (now - this.lastUpdate < 20.0) {
                return false;
            }

            //this._logInfo("updateBuffers time since last update = " + (now - this.lastUpdate));            
            //this._logInfo("video time since last update = " + (videoNow - this.lastVideoTime));
            this.lastVideoTime = videoNow;
            this.lastUpdate = now;

            var gl = this.gl;

            if (!this.watermarkPixels)
            {
                this.watermarkPixels = new Uint8Array(image.extensions[HoloVideoObject._extName].width * 4);
            }

            var videoSampleIndex = -1;

            var saveFbo  = gl.getParameter(gl.FRAMEBUFFER_BINDING);
            var saveTex = gl.getParameter(gl.TEXTURE_BINDING_2D);

            if (this.caps.webgl2) {

                var readPbo = (this.nextPbo + 1) % this.pixelBuffers.length;

                if (this.readFences[readPbo] != null) {

                    var status = gl.getSyncParameter(this.readFences[readPbo], gl.SYNC_STATUS);

                    if (status == gl.UNSIGNALED) {
                        this._logInfo("fence not signaled for readPbo = " + readPbo);
                        return false;
                    }

                    gl.deleteSync(this.readFences[readPbo]);
                    this.readFences[readPbo] = null;

                    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pixelBuffers[readPbo]);
                    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.watermarkPixels, 0, this.watermarkPixels.byteLength);                    

                    var blockSize = image.extensions[HoloVideoObject._extName].blockSize * 4;
                    videoSampleIndex = 0;
                    for (var i = 0 ; i < 16 ; ++i) {
                        if (this.watermarkPixels[blockSize*i+0] > 128 || this.watermarkPixels[blockSize*i+4] > 128) {
                            videoSampleIndex += 1 << i;
                                }
                                }

                    //this._logInfo("read pbo " + readPbo + " -> frame index " + videoSampleIndex);

                    // At this point we know that frame 'videoSampleIndex' is contained in textures[readPbo], but we don't want to copy it to client texture
                    // until we know we have the matching mesh frame.
                    }

                    if (!this.pixelBuffers[this.nextPbo])
                    {
                        this.pixelBuffers[this.nextPbo] = gl.createBuffer();
                        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pixelBuffers[this.nextPbo]);
                        gl.bufferData(gl.PIXEL_PACK_BUFFER, this.watermarkPixels.byteLength, gl.DYNAMIC_READ);
                    }

                // fill 'nextPbo' texture slice with current contents of video and start an async readback of the watermark pixels
                //this._logInfo("video -> texture slice " + this.nextPbo);

                gl.bindTexture(gl.TEXTURE_2D, this.textures[this.nextPbo]);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, currentVideo);

                gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo1);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[this.nextPbo], 0);
                gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pixelBuffers[this.nextPbo]);
                gl.readPixels(0, 0, this.watermarkPixels.byteLength / 4, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);

                //this._logInfo("read texture slice " + this.nextPbo + " -> pbo " + this.nextPbo);

                this.readFences[this.nextPbo] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
                this.nextPbo = (this.nextPbo + 1) % this.pixelBuffers.length;
                }

                else {

                    gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, currentVideo);

                    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo1);
                    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[0], 0);
                    gl.readPixels(0, 0, this.watermarkPixels.byteLength / 4, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.watermarkPixels);

                    var blockSize = image.extensions[HoloVideoObject._extName].blockSize * 4;
                    videoSampleIndex = 0;
                    for (var i = 0 ; i < 16 ; ++i) {
                        if (this.watermarkPixels[blockSize*i+0] > 128 || this.watermarkPixels[blockSize*i+4] > 128) {
                            videoSampleIndex += 1 << i;
                                }
                                }
                                }

                                if (videoSampleIndex > -1 && (this.curMesh == null || this.curMesh.frameIndex != videoSampleIndex)) {

                                    if (this.meshFrames[videoSampleIndex].ensureBuffers()) {

                                        if (videoSampleIndex < this.lastVideoSampleIndex) {
                                            this.frameIndex = -1;
                                            this._updateMesh(this.clientBuffers.posBuf, this.clientBuffers.uvBuf, this.clientBuffers.indexBuf, this.clientBuffers.norBuf);
                                            this._logInfo("loop detected, videoSampleIndex = " + videoSampleIndex + ", curMesh.frameIndex = " + this.curMesh.frameIndex);
                                        }

                                        while (this.curMesh == null || this.curMesh.frameIndex < videoSampleIndex) {
                                            if (!this._updateMesh(this.clientBuffers.posBuf, this.clientBuffers.uvBuf, this.clientBuffers.indexBuf, this.clientBuffers.norBuf)) {
                                                break;
                                            }
                                        }

                                        //this._logInfo("updated to frame index = "+ videoSampleIndex);

                                        // Don't update texture unless we were able to update mesh to target frame (the only reason this should ever be possible is if the mesh data isn't downloaded yet)
                                        // Note that we're not stopping the video -> texture -> pbo -> watermark loop from continuing, not sure if this matters?
                                        if (this.curMesh.frameIndex == videoSampleIndex) {
                                            var w = currentVideo.videoWidth;
                                            var h = currentVideo.videoHeight;
                                            if (this.caps.webgl2) {
                                                //if (this.textures[readPbo]) {
                                                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo1);
                                                gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[readPbo], 0);
                                                gl.readBuffer(gl.COLOR_ATTACHMENT0);

                                                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbo2);
                                                gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.clientBuffers.tex, 0);
                                                gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

                                                //this._logInfo("texture slice " + readPbo + " -> client texture");

                                                var status = gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER);
                                                var status2 = gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER);

                                                gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
                                                //  }
                                            }

                                            else {
                                                gl.bindTexture(gl.TEXTURE_2D, this.clientBuffers.tex);
                                                gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
                                            }
                                        }

                                        if (this.curMesh && this.curMesh.frameIndex != videoSampleIndex) {
                                            this._logInfo("texture <-> mesh mismatch");
                                        }
                                    }

                                    else {
                                        this._logInfo("ran out of mesh data, suspending video " + currentVideo.mp4Name);
                                        currentVideo.pause();
                                        this.suspended = true;
                                        this.needMeshData = true;
                                        if (!this.pendingBufferDownload) {
                                            this._loadNextBuffer();
                                        }
                                    }
                                }

                                this.lastVideoSampleIndex = videoSampleIndex;

                                gl.bindFramebuffer(gl.FRAMEBUFFER, saveFbo);
                                gl.bindTexture(gl.TEXTURE_2D, saveTex);
        }

        if (this.curMesh) {
            this.currentFrameInfo.primCount = this.curMesh.indexCount;
            this.currentFrameInfo.frameIndex = this.curMesh.frameIndex;
            return true;
        }

        return false;
    }

    close() {

        if (this.httpRequest) {
            this.httpRequest.abort();
            this.httpRequest = null;
        }

        if (this.dashPlayer) {
            this.dashPlayer.reset();
        }

        for (var i = 0 ; i < this.videoElements.length ; ++i) {
            this.videoElements[i].pause();
            this.videoElements[i].removeAttribute('src');
        }
        this.state = HoloVideoObject.States.Closed;
    }

    pause() {
        this.videoElements[this.currentVideoIndex].pause();
        this.state = HoloVideoObject.States.Paused;
    }

    setAudioVolume(volume) {
        this.audioVolume = volume;
        this.videoElements[this.currentVideoIndex].volume = volume;
    }

    setAutoLooping(loop) {
        this.openOptions.autoloop = loop;
        this.videoElements[this.currentVideoIndex].loop = loop;
    }

    setAudioEnabled(enabled) {
        this.videoElements[this.currentVideoIndex].muted = !enabled;
    }

    play() {
        var playPromise = this.videoElements[this.currentVideoIndex].play();

        if (playPromise !== undefined) {
            playPromise.then(_ => {
                this.state = HoloVideoObject.States.Playing;
            })
                .catch(error => {
                    // Auto-play was prevented
                    this._logInfo("play prevented: " + error);
                });
        }
    }

    open(gltfURL, options) {

        if (this.state >= HoloVideoObject.States.Opening)
        {
            this.close();
        }

        this.state = HoloVideoObject.States.Opening;

        // leave this pointing to parent directory of .gltf file so we can locate .bin, .mp4 files relative to it.
        this.urlRoot = gltfURL.substring(0, gltfURL.lastIndexOf("/") + 1);

        this.meshFrames = [];
        this.buffersLoaded = 0;
        this.videosLoaded = 0;

        // indices into arrays below for next objects we can load data into
        this.freeArrayBuffers = [];
        this.freeVideoElements = [];

        // owning references on video and buffer objects (max size 3)
        this.buffers = [];
        this.videoElements = [];

        // next video/buffer to load (ahead of playback position)
        this.nextVideoLoadIndex = 0;
        this.nextBufferLoadIndex = 0;

        this.currentFrameInfo = {
            primCount: 0
        };

        // these are current playback positions
        this.currentVideoIndex = 0;
        this.currentBufferIndex = -1;

        this.lastVideoTime = 0;
        this.lastUpdate = 0;

        this.json = null;
        this.fileInfo = {
            haveNormals : false,
            octEncodedNormals : false,
        };

        this.openOptions = {
            autoloop : false
        };

        if (options) {
            this.openOptions = options;
        }

        if (this.caps.webgl2) {
            for (var i = 0 ; i < this.readFences.length ; ++i) {
                if (this.readFences[i]) {
                    this.gl.deleteSync(this.readFences[i]);
                    this.readFences[i] = null;
                }
            }
        }

        this.nextPbo = 0;

        this.curMesh = null;
        this.prevMesh = null;
        this.prevPrevMesh = null;
        this.frameIndex = -1;
        this.lastVideoSampleIndex = -1;
        this.filledFallbackFrame = false;
        this.fallbackFrameBuffer = null;
        this.fallbackTextureImage = null;
        this.eos = false;

        this._loadJSON(gltfURL, this._onJsonLoaded.bind(this));
    }
}

if (typeof THREE != "undefined") {

    HoloVideoObjectThreeJS = class {

        _hvoOnEndOfStream(hvo) {
            if (this.onEndOfStream) {
                this.onEndOfStream(this);
            }
        }

        constructor(renderer, callback) {

            var hvo = new HoloVideoObject(renderer.getContext());
            this.hvo = hvo;
            hvo.onEndOfStream = this._hvoOnEndOfStream.bind(this);
            hvo.onLoaded = function(fileInfo) {

                var useNormals = fileInfo.haveNormals;

                var unlitMaterial = new THREE.MeshBasicMaterial( { map: null, transparent: false, side: THREE.DoubleSide } );
                var litMaterial = new THREE.MeshLambertMaterial( { map: null, transparent: false, side: THREE.DoubleSide } );

                if (this.mesh) {
                    var material = useNormals ? litMaterial : unlitMaterial;
                    material.map = this.mesh.material.map;
                    this.mesh.material = material;
                }

                else {

                    var gl = renderer.getContext();

                    var bufferGeometry = new THREE.BufferGeometry();
                    bufferGeometry.boundingSphere = new THREE.Sphere();
                    bufferGeometry.boundingSphere.set(new THREE.Vector3(), Infinity);
                    bufferGeometry.boundingBox = new THREE.Box3();
                    bufferGeometry.boundingBox.set(
                        new THREE.Vector3(-Infinity, -Infinity, -Infinity),
                        new THREE.Vector3(+Infinity, +Infinity, +Infinity)
                    );

                    bufferGeometry.setIndex([]);
                    bufferGeometry.addAttribute( 'position', new THREE.Float32BufferAttribute([], 3));

                    if (useNormals) {
                        bufferGeometry.addAttribute( 'normal', new THREE.Float32BufferAttribute([], 3));
                    }
                    bufferGeometry.addAttribute( 'uv', new THREE.Uint16BufferAttribute([], 2, true));
                    renderer.geometries.update(bufferGeometry);
                    var posBuf = renderer.attributes.get(bufferGeometry.attributes['position']).buffer;
                    var norBuf = null;
                    if (useNormals) {
                        norBuf = renderer.attributes.get(bufferGeometry.attributes['normal']).buffer;
                    }
                    var uvBuf = renderer.attributes.get(bufferGeometry.attributes['uv']).buffer;
                    var indexBuf = renderer.attributes.get(bufferGeometry.index).buffer;

                    var texture = new THREE.Texture();
                    texture.encoding = THREE.sRGBEncoding;
                    var texProps = renderer.properties.get(texture);
                    texProps.__webglTexture = gl.createTexture();

                    var material = useNormals ? litMaterial : unlitMaterial;
                    material.map = texture;

                    var mesh = new THREE.Mesh(bufferGeometry, material);
                    mesh.scale.x = 0.001;
                    mesh.scale.y = 0.001;
                    mesh.scale.z = 0.001;
                    hvo.setBuffers(posBuf, indexBuf, uvBuf, norBuf, texProps.__webglTexture);

                    var saveTex = gl.getParameter(gl.TEXTURE_BINDING_2D);

                    gl.bindTexture(gl.TEXTURE_2D, texProps.__webglTexture);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fileInfo.videoWidth, fileInfo.videoHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

                    gl.bindTexture(gl.TEXTURE_2D, saveTex);

                    this.mesh = mesh;
                    this.bufferGeometry = bufferGeometry;
                }
                this.state = this.hvo.state;
                callback(this.mesh);
            }.bind(this);
        }

        open (url, options) {
            if (this.state > HoloVideoObject.States.Empty) {
                this.close();
            }
            this.hvo.open(url, options);
            this.state = this.hvo.state;
        }

        update() {

            if (this.hvo && this.mesh) {
                this.state = this.hvo.state;
            }

            if (this.hvo.updateBuffers()) {

                var min = this.hvo.currentFrameInfo.bboxMin;
                var max = this.hvo.currentFrameInfo.bboxMax;

                var bufferGeometry = this.bufferGeometry;

                bufferGeometry.boundingBox.min.x = min[0];
                bufferGeometry.boundingBox.min.y = min[1];
                bufferGeometry.boundingBox.min.z = min[2];
                bufferGeometry.boundingBox.max.x = max[0];
                bufferGeometry.boundingBox.max.y = max[1];
                bufferGeometry.boundingBox.max.z = max[2];

                bufferGeometry.boundingBox.getCenter(bufferGeometry.boundingSphere.center);
                var maxSide = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
                bufferGeometry.boundingSphere.radius =  maxSide * 0.5;

                bufferGeometry.index.count = this.hvo.currentFrameInfo.primCount;
            }
        }

        rewind() {
            this.hvo.rewind();
        }

        play() {
            if (this.hvo.state == HoloVideoObject.States.Opening) {
                this.hvo.forceLoad();
            }

            else if (this.hvo.state >= HoloVideoObject.States.Opened && 
                this.hvo.state != HoloVideoObject.States.Playing) {
                this.hvo.play();
            }
        }

        close() {
            if (this.bufferGeometry) {
                this.bufferGeometry.index.count = 0;
            }
            this.hvo.close();
        }

        pause() {
            this.hvo.pause();
        }

        setLogLevel(level) {
            this.hvo.logLevel = level;
        }

        setAudioEnabled(enabled) {
            this.hvo.setAudioEnabled(enabled);
        }

        setAudioVolume(volume) {
            this.hvo.setAudioVolume(volume);
        }

        setAutoLooping(loop) {
            this.hvo.setAutoLooping(loop);
        }
    }
}

HoloVideoObject._instanceCounter = 0;

HoloVideoObject.States = {
    Closed:-1,
    Empty:0,
    Opening:1,
    Opened:2,
    Playing:3,
    Paused:4,
}

HoloVideoObject._extName = "HCAP_holovideo";

HoloVideoObject.Version = {};
HoloVideoObject.Version.Major = 0;
HoloVideoObject.Version.Minor = 2;
HoloVideoObject.Version.Patch = 2;
HoloVideoObject.Version.String = HoloVideoObject.Version.Major + "." + HoloVideoObject.Version.Minor + "." + HoloVideoObject.Version.Patch;
