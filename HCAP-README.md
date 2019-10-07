# 8th Wall notes

soccer.hcap is currently being hosted on 8th Wall's CDN. If you want to host your own files, you will need to update the path in index.js line 148 to point to your .hcap file.

You will also need to update the app key in index.html with your own.

Building a three.js scene with HCap content
============

- Version 0.2.2. Last updated June 24, 2019.

## Building three.js with HCap support

- Obtain three.js r104 from GitHub:
    ~~~~
    git clone --depth=1 --branch r104 https://github.com/mrdoob/three.js.git
    ~~~~

- Apply patch with hcap changes needed to support hologram playback:
    ~~~~
    cd three.js
    git am /path/to/hcap-three.js.patch
    ~~~~

- Follow three.js build instructions at https://github.com/mrdoob/three.js/wiki/Build-instructions to generate
concatenated three.js and three.min.js source files.

## Example scene
A minimal example scene can be found in `example-scene.html`. The next few sections call attention to some key features of this example, please refer to the full example code for complete integration details.

### WebGL2
The HCap web playback component requires support for WebGL 1.0 at minimum, but can perform significantly better with WebGL 2.0. By default `THREE.WebGLRenderer` will only create a WebGL 1.0 context so it's recommended that the application create its own context and pass this to the `THREE.WebGLRenderer` constructor as shown below:

~~~~
// try to create WebGL2 context
var context = canvas.getContext('webgl2');

// WebGL2 not available, fall back to WebGL1
if (!context) {
    context = canvas.getContext('webgl');
    if (!context) {
        alert('Unable to initialize WebGL. Your browser or machine may not support it.');
    }
}

// Construct THREE.WebGLRenderer using our new context:
renderer = new THREE.WebGLRenderer({ antialias: true, canvas: canvas, context: context });
~~~~

### Adding HCap content to the scene

The primary class for HCAP three.js web playback is `HoloVideoObjectThreeJS`. An instance of this class represents a hologram that can be played and rendered in the three.js scene with open/close/play/pause/rewind functionality to control playback.

The code to instantiate an instance of `HoloVideoObjectThreeJS` is shown below:

~~~~
hvo = new HoloVideoObjectThreeJS(renderer, function(mesh) {
    mesh.position.set(-100, 300, 600);
    mesh.scale.set(0.2, 0.2, 0.2);
    scene.add(mesh);
});
hvo.open("http://localhost:8000/soccer/soccer.hcap", {autoloop:true, audioEnabled:true});
~~~~

Arguments passed to the constructor are the `THREE.WebGLRenderer` object, and a callback function that will be invoked when minimal playback data has been loaded and a preview frame is able to be displayed in the scene. The argument to this callback function is a `THREE.Mesh` instance that can be positioned and added to the scene at this point. This mesh will be updated with the animating capture geometry once playback begins.

### Starting playback

When the open callback is invoked, the `HoloVideoObjectThreeJS` instance will have at least one preview frame loaded but it may require additional time to buffer the rest of the capture. The application should monitor the `state` property of the `HoloVideoObjectThreeJS` instance until it reaches the value of `HoloVideoObject.State.Opened`, at which point playback can be started.

Many browsers will only allow video playback to be initiated in response to user input, so to begin playback the application should call the `HoloVideoObjectThreeJS.play()` method from a user input event handler as shown below:

~~~~
renderer.domElement.addEventListener('mousedown', function() {
if (hvo.state == HoloVideoObject.States.Opened ||
    hvo.state == HoloVideoObject.States.Opening) {
    hvo.play();
}});
~~~~

### Displaying animated HCap content

In order to update the hologram `THREE.Mesh` instance to display the texture and geometry for the current frame of playback, the `HoloVideoObjectThreeJS.update()` method needs to be called from the application's animation tick method as shown below:

~~~~
function animate() {
    requestAnimationFrame(animate);

    // update hologram to latest frame of playback:
    hvo.update();

    // let three.js render the scene:
    renderer.render(scene, camera);
}
~~~~

### Materials

The `THREE.Mesh` object created by a `HoloVideoObjectThreeJS` instance will be assigned a `THREE.MeshLambertMaterial` material for captures that contain vertex normals, and a `THREE.MeshBasicMaterial` material for captures without normals. The application can replace the default material however if desired. An example is shown below which takes the hologram texture from the default material and uses it to assign a new red-tinted material to the mesh:

~~~~
hvo = new HoloVideoObjectThreeJS(renderer, function(mesh) {
    mesh.material = new THREE.MeshBasicMaterial({color: 0xff0000, map: mesh.material.map});
    // code to position mesh, add to scene, etc
});
~~~~

### DASH streaming

MPEG-DASH is the preferred streaming format for HCap content on browsers other than Safari. DASH playback requires the `dash.js` player script from https://github.com/Dash-Industry-Forum/dash.js. The following line can be used to include the `dash.js` player implementation in a web page:
~~~~
<script src="https://cdn.dashjs.org/latest/dash.mediaplayer.min.js"></script>
~~~~

### Known Limitations
- In Safari on iOS even preloading video content is not allowed without user interaction. This means that after calling `HoloVideoObjectThreeJS.open()` with a capture URL, the `HoloVideoObjectThreeJS` instance will be unable to reach the `HoloVideoObject.State.Opened` state on its own. `HoloVideoObjectThreeJS.play()` can still be called from an input event handler, but only at this point will the video begin buffering. Playback will then begin once when buffering is complete. Because of this limitation it may be desireable to display a loading indicator to the user until the `HoloVideoObjectThreeJS` instance reaches the `HoloVideoObject.State.Playing` state.

- The `THREE.Mesh` associated with a `HoloVideoObjectThreeJS` instance is populated directly via WebGL during playback. As a result three.js doesn't have a frame-accurate copy of the geometry to use for operations like raycasting, and such operations may not return accurate results. The capture mesh will maintain an accurate bounding box however which can be used for simple selection and culling operations.

