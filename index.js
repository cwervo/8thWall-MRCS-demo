// Copyright (c) 2018 8th Wall, Inc.

// Returns a pipeline module that initializes the threejs scene when the camera feed starts, and
// handles subsequent spawning of a glb model whenever the scene is tapped.
const placegroundScenePipelineModule = () => {
    const modelFile = 'tree.glb'                                 // 3D model to spawn at tap
    const startScale = new THREE.Vector3(0.0001, 0.0001, 0.0001) // Initial scale value for our model
    const endScale = new THREE.Vector3(0.0025, 0.0025, 0.0025)      // Ending scale value for our model
    const animationMillis = 1000                                  // Animate over 0.75 seconds

    const raycaster = new THREE.Raycaster()
    const tapPosition = new THREE.Vector2()
    // const loader = new THREE.GLTFLoader()  // This comes from GLTFLoader.js.

    let surface  // Transparent surface for raycasting for object placement.

    // Populates some object into an XR scene and sets the initial camera position. The scene and
    // camera come from xr3js, and are only available in the camera loop lifecycle onStart() or later.
    const initXrScene = ({ scene, camera, renderer }) => {
        console.log('initXrScene')
        surface = new THREE.Mesh(
            new THREE.PlaneGeometry( 100, 100, 1, 1 ),
            new THREE.MeshBasicMaterial({
                color: 0xffff00,
                transparent: true,
                opacity: 0.0,
                side: THREE.DoubleSide
            })
        )

        surface.rotateX(-Math.PI / 2)
        surface.position.set(0, 0, 0)
        scene.add(surface)

        // // source:  https://poly.google.com/view/7t4hmicGHV4
        // loader.load( 'gltf/goal.glb',
        //   (gltf) => {
        //     gltf.scene.rotateY(Math.PI / 0.3)
        //     gltf.scene.position.set(-4, 0, -5)
        //     gltf.scene.scale.set(0.8, 0.8, 0.8);
        //     gltf.scene.traverse( function( node ) {
        //       if ( node instanceof THREE.Mesh ) { node.castShadow = true; }
        //     } );
        //     scene.add( gltf.scene );
        //     console.log('added goal!')
        //   },
        //   (xhr) => {console.log(`${(xhr.loaded / xhr.total * 100 )}% loaded`)},
        //   (error) => {
        //     console.log(error)
        //   }
        // )

        // // source: https://poly.google.com/view/0PpSxxQVOxY
        // loader.load( 'gltf/bottle-new.glb', function ( gltf ) {
        //   // gltf.scene.rotateX(-Math.PI / 2)
        //   gltf.scene.position.set(-4, 0, 0)
        //   gltf.scene.scale.set(0.25, 0.25, 0.25);
        //   gltf.scene.traverse( function( node ) {
        //     if ( node instanceof THREE.Mesh ) { node.castShadow = true; }
        //   } );
        //   scene.add( gltf.scene );
        //   console.log('added!')
        // }, undefined, function ( error ) {
        //   console.error( error );
        // } );

        // // source: https://poly.google.com/view/6pwiq7hSrHr
        // loader.load( 'gltf/tree.glb', function ( gltf ) {
        //   // gltf.scene.rotateY(-Math.PI / 2)
        //   gltf.scene.position.set(6, 0, -2)
        //   gltf.scene.scale.set(0.015, 0.015, 0.015);
        //   gltf.scene.traverse( function( node ) {
        //     if ( node instanceof THREE.Mesh ) { node.castShadow = true; }
        //   } );
        //   scene.add( gltf.scene );
        //   console.log('added!')
        // }, undefined, function ( error ) {
        //   console.error( error );
        // } );

        // //
        // loader.load( 'gltf/billboard.glb', function ( gltf ) {
        //   gltf.scene.rotateY(-Math.PI / 7)
        //   gltf.scene.position.set(2, 0, -7)
        //   gltf.scene.scale.set(50, 50, 50);
        //   gltf.scene.traverse( function( node ) {
        //     if ( node instanceof THREE.Mesh ) { node.castShadow = true; }
        //   } );
        //   scene.add( gltf.scene );
        //   console.log('added billboard!')
        // }, undefined, function ( error ) {
        //   console.error( error );
        // } );

        //scene.add(new THREE.AmbientLight( 0x404040, 5 ))  // Add soft white light to the scene.

        light = new THREE.SpotLight( 0xffffff, 1, 0, Math.PI / 2 );
        light.position.set( 3, 25, 2);
        light.target.position.set( 0, 0, 0 );
        light.castShadow = true;
        light.shadow = new THREE.LightShadow( new THREE.PerspectiveCamera( 50, 1, 0.01, 60 ) );
        light.shadow.bias = 0.00001;
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;

        scene.add( light );

        var ambLight = new THREE.AmbientLight( 0x404040 ); // soft white light
        ambLight.intensity = 0.75
        scene.add( ambLight );

        var geometry = new THREE.PlaneBufferGeometry( 3, 3 );
        //var material = new THREE.MeshPhongMaterial( { color: 0xffb851 } );
        var material = new THREE.ShadowMaterial();
        material.opacity = 0.5;
        material.depthWrite = false;
        var ground = new THREE.Mesh( geometry, material );
        ground.position.set( 0, 0.01, 0 );
        ground.rotation.x = - Math.PI / 2;
        ground.scale.set( 10, 10, 10 );
        ground.castShadow = false;
        ground.receiveShadow = true;
        //ground.renderDepth = 1;

        scene.add( ground );

        // Set the initial camera position relative to the scene we just laid out. This must be at a
        // height greater than y=0.
        camera.position.set(0, 3, 3)

        renderer.gammaOutput = true;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        //renderer.sortObjects = false;

        // Add HCap content:
        hvo = new HoloVideoObjectThreeJS(
            renderer,
            function(mesh) {
                mesh.position.set(0, 0, 0);
                mesh.rotation.set(0, -3.14, 0);
                mesh.scale.set(0.0025, 0.0025, 0.0025);
                mesh.visible = false
                mesh.castShadow = true;
                scene.add(mesh);
            });
        hvo.setLogLevel(2);
        hvo.open("https://cdn.8thwall.com/web/hcap/microsoft-soccer/soccer.hcap", {autoloop:true, audioEnabled:true});
    }

    const animateIn = (pointX, pointZ) => {
        console.log(`animateIn: ${pointX}, ${pointZ}`)
        const scale = Object.assign({}, startScale)

        hvo.mesh.position.set(pointX, 0.0, pointZ)
        hvo.mesh.scale.set(scale.x, scale.y, scale.z)

        new TWEEN.Tween(scale)
            .to(endScale, animationMillis)
            .easing(TWEEN.Easing.Elastic.Out) // Use an easing function to make the animation smooth.
            .onUpdate(() => { hvo.mesh.scale.set(scale.x, scale.y, scale.z) })
            .start() // Start the tween immediately.
    }

    // Load the glb model at the requested point on the surface.
    const placeObject = (pointX, pointZ) => {
        console.log(`placing at ${pointX}, ${pointZ}`)
        hvo.mesh.position.set(pointX, 0, pointZ);
        /*loader.load(
      modelFile,                                                              // resource URL.
      (gltf) => { animateIn(gltf, pointX, pointZ, Math.random() * 360) },     // loaded handler.
      (xhr) => {console.log(`${(xhr.loaded / xhr.total * 100 )}% loaded`)},   // progress handler.
      (error) => {console.log('An error happened')}                           // error handler.
    )*/
    }

    const placeObjectTouchHandler = (e) => {
        console.log('placeObjectTouchHandler')

        hvo.mesh.visible = true
        document.getElementById('overlay').style.display = 'none'

        if (hvo.state == HoloVideoObject.States.Opened ||
            hvo.state == HoloVideoObject.States.Opening) {
            hvo.play();
        }

        // Call XrController.recenter() when the canvas is tapped with two fingers. This resets the
        // AR camera to the position specified by XrController.updateCameraProjectionMatrix() above.
        if (e.touches.length == 2) {
            XR.XrController.recenter()
        }

        if (e.touches.length > 2) {
            return
        }

        // If the canvas is tapped with one finger and hits the "surface", spawn an object.
        const {scene, camera, renderer} = XR.Threejs.xrScene()

        // calculate tap position in normalized device coordinates (-1 to +1) for both components.
        tapPosition.x = (e.touches[0].clientX / window.innerWidth) * 2 - 1
        tapPosition.y = - (e.touches[0].clientY / window.innerHeight) * 2 + 1

        // Update the picking ray with the camera and tap position.
        raycaster.setFromCamera(tapPosition, camera)

        // Raycast against the "surface" object.
        const intersects = raycaster.intersectObject(surface)

        if (intersects.length == 1 && intersects[0].object == surface) {
            animateIn(intersects[0].point.x, intersects[0].point.z)
            // placeObject(intersects[0].point.x, intersects[0].point.z)
        }
    }

    return {
        // Pipeline modules need a name. It can be whatever you want but must be unique within your app.
        name: 'placeground',

        onUpdate: () => {
            // update hologram to latest frame of playback:
            if (hvo) {
                hvo.update();
            }
        },

        // onStart is called once when the camera feed begins. In this case, we need to wait for the
        // XR.Threejs scene to be ready before we can access it to add content. It was created in
        // XR.Threejs.pipelineModule()'s onStart method.
        onStart: ({canvas, canvasWidth, canvasHeight}) => {
            const {scene, camera, renderer} = XR.Threejs.xrScene()  // Get the 3js sceen from xr3js.

            initXrScene({ scene, camera, renderer }) // Add objects to the scene and set starting camera position.

            canvas.addEventListener('touchstart', placeObjectTouchHandler, true)  // Add touch listener.

            // Enable TWEEN animations.
            animate()
            function animate(time) {
                requestAnimationFrame(animate)
                TWEEN.update(time)
            }

            // Sync the xr controller's 6DoF position and camera paremeters with our scene.
            XR.XrController.updateCameraProjectionMatrix({
                origin: camera.position,
                facing: camera.quaternion,
            })
        },
    }
}

const onxrloaded = () => {
    XR.addCameraPipelineModules([  // Add camera pipeline modules.
        // Existing pipeline modules.
        XR.GlTextureRenderer.pipelineModule(),       // Draws the camera feed.
        XR.Threejs.pipelineModule(),                 // Creates a ThreeJS AR Scene.
        XR.XrController.pipelineModule(),            // Enables SLAM tracking.
        XRExtras.AlmostThere.pipelineModule(),       // Detects unsupported browsers and gives hints.
        XRExtras.FullWindowCanvas.pipelineModule(),  // Modifies the canvas to fill the window.
        XRExtras.Loading.pipelineModule(),           // Manages the loading screen on startup.
        XRExtras.RuntimeError.pipelineModule(),      // Shows an error image on runtime error.
        // Custom pipeline modules.
        placegroundScenePipelineModule(),
    ])

    // Open the camera and start running the camera run loop.
    XR.run({canvas: document.getElementById('camerafeed')})
}

// Show loading screen before the full XR library has been loaded.
const load = () => { XRExtras.Loading.showLoading({onxrloaded}) }
window.onload = () => { window.XRExtras ? load() : window.addEventListener('xrextrasloaded', load) }
