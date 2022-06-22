import { THREE } from "aframe";
import audioDebugVert from "./audio-debug.vert";
import audioDebugFrag from "./audio-debug.frag";
import { DistanceModelType } from "../components/audio-params";
import { getWebGLVersion } from "../utils/webgl";
import { getMeshes } from "../utils/aframe-utils";

const fakePanner = {
  distanceModel: DistanceModelType.Inverse,
  maxDistance: 0,
  refDistance: 0,
  rolloffFactor: 0,
  coneInnerAngle: 0,
  coneOuterAngle: 0
};

AFRAME.registerSystem("audio-debug", {
  schema: {
    enabled: { default: false }
  },

  init() {
    this.max_debug_sources = 64;
    this.unsupported = false;
    const webGLVersion = getWebGLVersion(this.el.sceneEl.renderer);
    if (webGLVersion < "2.0") {
      this.unsupported = true;
    } else {
      const gl = this.el.sceneEl.renderer.getContext();
      const max_f_vectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
      // 10 is the number of uniform vectors in the shader. If we update that, this number must be updated accordingly.
      this.max_debug_sources = Math.min(Math.floor(max_f_vectors / 10), this.max_debug_sources);
    }

    window.APP.store.addEventListener("statechanged", this.updateState.bind(this));

    this.onSceneLoaded = this.onSceneLoaded.bind(this);
    this.el.sceneEl.addEventListener("environment-scene-loaded", this.onSceneLoaded);

    this.navMeshObject = null;
    this.zones = [];

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
        colorInner: { value: new THREE.Color("#7AFF59") },
        colorOuter: { value: new THREE.Color("#FF6340") },
        colorGain: { value: new THREE.Color("#70DBFF") },
        count: { value: 0 },
        maxDistance: { value: [] },
        refDistance: { value: [] },
        rolloffFactor: { value: [] },
        distanceModel: { value: [] },
        sourcePosition: { value: [] },
        sourceOrientation: { value: [] },
        coneInnerAngle: { value: [] },
        coneOuterAngle: { value: [] },
        gain: { value: [] },
        clipped: { value: [] }
      },
      vertexShader: audioDebugVert,
      fragmentShader: audioDebugFrag
    });
    this.material.side = THREE.FrontSide;
    this.material.transparent = true;
    this.material.uniforms.count.value = 0;
    this.material.defines.MAX_DEBUG_SOURCES = this.max_debug_sources;

    this.sourcePositions = new Array(this.max_debug_sources);
    this.sourcePositions.fill(new THREE.Vector3());
    this.sourceOrientations = new Array(this.max_debug_sources);
    this.sourceOrientations.fill(new THREE.Vector3());
    this.distanceModels = new Array(this.max_debug_sources);
    this.distanceModels.fill(0);
    this.maxDistances = new Array(this.max_debug_sources);
    this.maxDistances.fill(0.0);
    this.refDistances = new Array(this.max_debug_sources);
    this.refDistances.fill(0.0);
    this.rolloffFactors = new Array(this.max_debug_sources);
    this.rolloffFactors.fill(0.0);
    this.coneInnerAngles = new Array(this.max_debug_sources);
    this.coneInnerAngles.fill(0.0);
    this.coneOuterAngles = new Array(this.max_debug_sources);
    this.coneOuterAngles.fill(0.0);
    this.gains = new Array(this.max_debug_sources);
    this.gains.fill(0.0);
    this.clipped = new Array(this.max_debug_sources);
    this.clipped.fill(0.0);
  },

  remove() {
    window.APP.store.removeEventListener("statechanged", this.updateState);
    this.el.sceneEl.removeEventListener("environment-scene-loaded", this.onSceneLoaded);
  },

  registerZone(zone) {
    this.zones.push(zone);
  },

  unregisterZone(zone) {
    const index = this.zones.indexOf(zone);

    if (index !== -1) {
      this.zones.splice(index, 1);
    }
  },

  tick: (() => {
    const sourcePos = new THREE.Vector3();
    const sourceDir = new THREE.Vector3();
    return function(time) {
      if (!this.data.enabled) {
        return;
      }

      let sourceNum = 0;
      for (const [el, audio] of APP.audios.entries()) {
        if (sourceNum >= this.max_debug_sources) continue;
        if (APP.isAudioPaused.has(el)) continue;

        audio.getWorldPosition(sourcePos);
        audio.getWorldDirection(sourceDir);
        this.sourcePositions[sourceNum] = this.navMeshObject.worldToLocal(sourcePos).clone(); // TODO: Use Vector3 pool
        this.sourceOrientations[sourceNum] = this.navMeshObject.worldToLocal(sourceDir).clone();

        const panner = audio.panner || fakePanner;

        this.distanceModels[sourceNum] = 0;
        if (panner.distanceModel === DistanceModelType.Linear) {
          this.distanceModels[sourceNum] = 0;
        } else if (panner.distanceModel === DistanceModelType.Inverse) {
          this.distanceModels[sourceNum] = 1;
        } else if (panner.distanceModel === DistanceModelType.Exponential) {
          this.distanceModels[sourceNum] = 2;
        }
        this.maxDistances[sourceNum] = panner.maxDistance;
        this.refDistances[sourceNum] = panner.refDistance;
        this.rolloffFactors[sourceNum] = panner.rolloffFactor;
        this.coneInnerAngles[sourceNum] = panner.coneInnerAngle;
        this.coneOuterAngles[sourceNum] = panner.coneOuterAngle;

        this.gains[sourceNum] = audio.gain.gain.value;
        this.clipped[sourceNum] = APP.clippingState.has(el);
        sourceNum++;
      }

      // Update material uniforms
      this.material.uniforms.time.value = time;
      this.material.uniforms.distanceModel.value = this.distanceModels;
      this.material.uniforms.maxDistance.value = this.maxDistances;
      this.material.uniforms.refDistance.value = this.refDistances;
      this.material.uniforms.rolloffFactor.value = this.rolloffFactors;
      this.material.uniforms.sourcePosition.value = this.sourcePositions;
      this.material.uniforms.sourceOrientation.value = this.sourceOrientations;
      this.material.uniforms.count.value = sourceNum;
      this.material.uniforms.coneInnerAngle.value = this.coneInnerAngles;
      this.material.uniforms.coneOuterAngle.value = this.coneOuterAngles;
      this.material.uniforms.gain.value = this.gains;
      this.material.uniforms.clipped.value = this.clipped;
    };
  })(),

  enableDebugMode(enabled, force = false) {
    if (((enabled === undefined || enabled === this.data.enabled) && !force) || this.unsupported) return;
    this.zones.forEach(zone => {
      zone.el.setAttribute("audio-zone", "debuggable", enabled);
    });

    const collisionEntities = Array.from(this.el.sceneEl.querySelectorAll("[nav-mesh]"));
    const meshes = getMeshes(collisionEntities);

    if (meshes.length) {
      this.data.enabled = enabled;
      meshes.forEach(obj => {
        if (obj.isMesh) {
          this.navMeshObject = obj;
          obj.parent.visible = enabled;
          if (obj.material) {
            if (enabled) {
              !obj._hubs_audio_debug_prev_material && (obj._hubs_audio_debug_prev_material = obj.material);
              obj.material = this.material;
              obj.material.needsUpdate = true;
            } else if (obj._hubs_audio_debug_prev_material) {
              obj.material = obj._hubs_audio_debug_prev_material;
              obj._hubs_audio_debug_prev_material = null;
              obj.material.needsUpdate = true;
            }
            obj.geometry.computeVertexNormals();
          }
        }
      });
    }

    if (!this.navMeshObject) {
      this.data.enabled = false;
    }
  },

  updateState({ force }) {
    const isEnabled = window.APP.store.state.preferences.showAudioDebugPanel;
    if (force || isEnabled !== this.data.enabled) {
      this.enableDebugMode(isEnabled, force);
    }
  },

  onSceneLoaded() {
    this.navMeshObject = null;
    this.updateState({ force: true });
  }
});
