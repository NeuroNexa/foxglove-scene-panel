import { ReactElement, useEffect, useRef } from "react";
import {
  AxesHelper,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  GridHelper,
  Group,
  LineBasicMaterial,
  MOUSE,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Plane,
  Points,
  PointsMaterial,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { InteractionMode } from "./interaction";
import type { FramePose, PointCloudRenderable, Vec3 } from "./sceneTypes";

type ThreeSceneProps = {
  pointClouds: PointCloudRenderable[];
  frames: FramePose[];
  fixedFrame: string;
  colorScheme: "dark" | "light";
  interactionMode: InteractionMode;
  publishingEnabled: boolean;
  onPublishPoint: (point: Vec3) => void;
  onPublishPose: (
    mode: Extract<InteractionMode, "initialPose" | "goalPose">,
    payload: { position: Vec3; yaw: number },
  ) => void;
};

type ClickState = {
  pointerId: number;
  button: number;
  downPos: Vector2;
  downTime: number;
  isDragging: boolean;
};

const DEFAULT_POINT_COLOR = new Color("#3aa0ff");
const PREVIEW_COLOR = 0xff2ad9;
const PREVIEW_HIGHLIGHT_COLOR = 0xff7bff;
const PREVIEW_BODY_RADIUS = 0.12;
const PREVIEW_HEAD_RATIO = 0.3;
const PREVIEW_HEAD_MIN = 0.5;
const PREVIEW_BODY_MIN = 0.1;
const HEIGHT_MIN = -10;
const HEIGHT_MAX = 60;

type PreviewArrow = {
  group: Group;
  body: Mesh;
  head: Mesh;
  ring: Mesh;
  dispose: () => void;
};

type HeightGizmo = {
  group: Group;
  shaft: Mesh;
  handle: Mesh;
  dispose: () => void;
};

export function ThreeScene(props: ThreeSceneProps): ReactElement {
  const { pointClouds, frames, fixedFrame, colorScheme, interactionMode } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WebGLRenderer>();
  const sceneRef = useRef<Scene>();
  const cameraRef = useRef<PerspectiveCamera>();
  const controlsRef = useRef<OrbitControls>();
  const gridRef = useRef<GridHelper>();
  const tfGroupRef = useRef<Group>();
  const cloudGroupRef = useRef<Group>();
  const cloudMapRef = useRef<Map<string, Points>>(new Map());
  const frameMapRef = useRef<Map<string, Group>>(new Map());
  const previewRef = useRef<PreviewArrow>();
  const clickStateRef = useRef<ClickState>();
  const poseBaseRef = useRef<Vector3>();
  const poseDirectionRef = useRef<Vector3 | undefined>(undefined);
  const posePreviewLengthRef = useRef(0.3);
  const poseHeightRef = useRef(0);
  const heightGizmoRef = useRef<HeightGizmo>();
  const heightDragActiveRef = useRef(false);
  const heightDragOffsetRef = useRef(0);
  const animationRef = useRef<number>();
  const resizeObserverRef = useRef<ResizeObserver>();
  const raycasterRef = useRef(new Raycaster());
  const pointerRef = useRef(new Vector2());
  const planeRef = useRef(new Plane(new Vector3(0, 0, 1), 0));
  const needsAutoFrameRef = useRef(true);

  const callbacksRef = useRef({
    interactionMode: props.interactionMode,
    publishingEnabled: props.publishingEnabled,
    onPublishPoint: props.onPublishPoint,
    onPublishPose: props.onPublishPose,
  });

  useEffect(() => {
    callbacksRef.current = {
      interactionMode: props.interactionMode,
      publishingEnabled: props.publishingEnabled,
      onPublishPoint: props.onPublishPoint,
      onPublishPose: props.onPublishPose,
    };
  }, [props.interactionMode, props.publishingEnabled, props.onPublishPoint, props.onPublishPose]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const renderer = new WebGLRenderer({ antialias: true });
    rendererRef.current = renderer;

    const scene = new Scene();
    sceneRef.current = scene;

    const camera = new PerspectiveCamera(60, 1, 0.1, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(6, -8, 6);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.target.set(0, 0, 0);
    controls.mouseButtons = {
      LEFT: MOUSE.PAN,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.ROTATE,
    };
    controlsRef.current = controls;

    const grid = new GridHelper(20, 20);
    grid.geometry.rotateX(Math.PI / 2);
    scene.add(grid);
    gridRef.current = grid;

    const tfGroup = new Group();
    scene.add(tfGroup);
    tfGroupRef.current = tfGroup;

    const cloudGroup = new Group();
    scene.add(cloudGroup);
    cloudGroupRef.current = cloudGroup;

    const previewArrow = createPreviewArrow();
    scene.add(previewArrow.group);
    previewRef.current = previewArrow;

    const heightGizmo = createHeightGizmo();
    scene.add(heightGizmo.group);
    heightGizmoRef.current = heightGizmo;

    containerRef.current.appendChild(renderer.domElement);

    const resizeObserver = new ResizeObserver(() => {
      resizeRenderer();
    });
    resizeObserver.observe(containerRef.current);
    resizeObserverRef.current = resizeObserver;

    function renderLoop(): void {
      animationRef.current = requestAnimationFrame(renderLoop);
      controls.update();
      renderer.render(scene, camera);
    }
    renderLoop();

    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", handlePointerDown, { passive: false });
    canvas.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);

    resizeRenderer();
    applyColorScheme(colorScheme);

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      resizeObserver.disconnect();
      if (animationRef.current !== undefined) {
        cancelAnimationFrame(animationRef.current);
      }
      previewRef.current?.dispose();
      heightGizmoRef.current?.dispose();
      renderer.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    applyColorScheme(colorScheme);
  }, [colorScheme]);

  useEffect(() => {
    updatePointClouds(pointClouds);
  }, [pointClouds]);

  useEffect(() => {
    updateFrames(frames, fixedFrame);
  }, [frames, fixedFrame]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (controls) {
      controls.enabled = true;
    }
    poseBaseRef.current = undefined;
    clickStateRef.current = undefined;
    hidePreviewArrow();
    hideHeightGizmo();
  }, [interactionMode]);

  function resizeRenderer(): void {
    const renderer = rendererRef.current;
    const container = containerRef.current;
    const camera = cameraRef.current;
    if (!renderer || !container || !camera) {
      return;
    }
    const { clientWidth, clientHeight } = container;
    renderer.setPixelRatio(window.devicePixelRatio ?? 1);
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / Math.max(clientHeight, 1);
    camera.updateProjectionMatrix();
  }

  function updatePointClouds(data: PointCloudRenderable[]): void {
    const group = cloudGroupRef.current;
    if (!group) {
      return;
    }

    const map = cloudMapRef.current;
    const nextIds = new Set(data.map((cloud) => cloud.id));
    for (const [id, mesh] of map.entries()) {
      if (!nextIds.has(id)) {
        group.remove(mesh);
        (mesh.geometry as BufferGeometry).dispose();
        (mesh.material as PointsMaterial).dispose();
        map.delete(id);
      }
    }

    for (const cloud of data) {
      const existing = map.get(cloud.id);
      if (existing) {
        updatePointCloudMesh(existing, cloud);
        continue;
      }
      const mesh = createPointCloudMesh(cloud);
      group.add(mesh);
      map.set(cloud.id, mesh);
      if (needsAutoFrameRef.current) {
        focusCameraOnMesh(mesh);
        needsAutoFrameRef.current = false;
      }
    }
  }

  function updateFrames(list: FramePose[], fixed: string): void {
    const tfGroup = tfGroupRef.current;
    if (!tfGroup) {
      return;
    }

    const map = frameMapRef.current;
    const nextIds = new Set(list.map((frame) => frame.frameId));
    for (const [frameId, object] of map.entries()) {
      if (!nextIds.has(frameId)) {
        disposeFrame(object);
        tfGroup.remove(object);
        map.delete(frameId);
      }
    }

    for (const frame of list) {
      const existing = map.get(frame.frameId);
      if (existing) {
        existing.matrix.copy(frame.matrix as Matrix4);
        existing.matrixWorldNeedsUpdate = true;
        continue;
      }
      const group = new Group();
      group.matrixAutoUpdate = false;
      group.matrix.copy(frame.matrix as Matrix4);
      group.matrixWorldNeedsUpdate = true;

      const axes = new AxesHelper(0.4);
      group.add(axes);

      const label = createLabelSprite(frame.frameId === fixed ? `${frame.frameId} (固定)` : frame.frameId);
      label.position.set(0, 0, 0.35);
      group.add(label);

      tfGroup.add(group);
      map.set(frame.frameId, group);
    }
  }

  function applyColorScheme(scheme: "dark" | "light"): void {
    const renderer = rendererRef.current;
    const grid = gridRef.current;
    if (!renderer || !grid) {
      return;
    }

    renderer.setClearColor(scheme === "dark" ? 0x050608 : 0xf9fafb);
    const main = scheme === "dark" ? 0x304878 : 0x6c7ea4;
    const center = scheme === "dark" ? 0x3c82ff : 0x2a5ee8;
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
    materials.forEach((material, index) => {
      (material as LineBasicMaterial).color.set(index === 0 ? main : center);
    });
  }

  function createPointCloudMesh(cloud: PointCloudRenderable): Points {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(cloud.positions, 3));
    if (cloud.colors) {
      geometry.setAttribute("color", new Float32BufferAttribute(cloud.colors, 3));
    }

    const material = new PointsMaterial({
      size: 0.05,
      vertexColors: Boolean(cloud.colors),
      color: cloud.colors ? undefined : DEFAULT_POINT_COLOR,
      sizeAttenuation: true,
    });

    const points = new Points(geometry, material);
    points.matrixAutoUpdate = false;
    points.matrix.copy(cloud.matrix);
    points.matrixWorldNeedsUpdate = true;
    return points;
  }

  function updatePointCloudMesh(mesh: Points, cloud: PointCloudRenderable): void {
    const geometry = mesh.geometry as BufferGeometry;
    const positionAttr = geometry.getAttribute("position") as BufferAttribute | undefined;

    if (!positionAttr || positionAttr.array.length !== cloud.positions.length) {
      geometry.setAttribute("position", new Float32BufferAttribute(cloud.positions, 3));
    } else {
      positionAttr.set(cloud.positions);
      positionAttr.needsUpdate = true;
    }

    const colorAttr = geometry.getAttribute("color") as BufferAttribute | undefined;
    if (cloud.colors) {
      if (!colorAttr || colorAttr.array.length !== cloud.colors.length) {
        geometry.setAttribute("color", new Float32BufferAttribute(cloud.colors, 3));
      } else {
        colorAttr.set(cloud.colors);
        colorAttr.needsUpdate = true;
      }
    } else if (colorAttr) {
      geometry.deleteAttribute("color");
    }

    mesh.matrix.copy(cloud.matrix);
    mesh.matrixWorldNeedsUpdate = true;
  }

  function focusCameraOnMesh(mesh: Points): void {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) {
      return;
    }

    const geometry = mesh.geometry as BufferGeometry;
    const positionAttr = geometry.getAttribute("position") as BufferAttribute | undefined;
    if (!positionAttr) {
      return;
    }

    const box = new Box3().setFromBufferAttribute(positionAttr);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const radius = Math.max(size.length(), 1);

    const worldCenter = center.applyMatrix4(mesh.matrix);

    controls.target.copy(worldCenter);
    camera.position.copy(worldCenter.clone().add(new Vector3(radius * 0.4, -radius * 0.6, radius * 0.6)));
    camera.updateProjectionMatrix();
  }

  function showPreviewAtBase(base: Vector3): void {
    const preview = previewRef.current;
    if (!preview) {
      return;
    }
    posePreviewLengthRef.current = 0.3;
    preview.group.position.copy(base);
    updatePreviewArrow(preview, new Vector3(1, 0, 0), posePreviewLengthRef.current);
    preview.group.visible = true;
    preview.group.updateMatrixWorld(true);
  }

  function hidePreviewArrow(): void {
    posePreviewLengthRef.current = 0.3;
    poseDirectionRef.current = undefined;
    if (previewRef.current) {
      previewRef.current.group.visible = false;
    }
  }

  function setInteractionPlaneHeight(height: number): void {
    const clamped = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, height));
    poseHeightRef.current = clamped;
    planeRef.current.constant = -clamped;
  }

  function showHeightGizmo(base: Vector3): void {
    const gizmo = heightGizmoRef.current;
    if (!gizmo) {
      return;
    }
    gizmo.group.position.set(base.x, base.y, 0);
    updateHeightGizmo(base.z);
    gizmo.group.visible = true;
  }

  function hideHeightGizmo(): void {
    heightDragActiveRef.current = false;
    const gizmo = heightGizmoRef.current;
    if (gizmo) {
      gizmo.group.visible = false;
    }
  }

  function updateHeightGizmo(targetHeight: number): void {
    const gizmo = heightGizmoRef.current;
    const base = poseBaseRef.current;
    if (!gizmo || !base) {
      return;
    }
    const clamped = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, targetHeight));
    const span = Math.max(clamped - HEIGHT_MIN, 0.01);
    gizmo.shaft.scale.set(1, 1, span);
    gizmo.shaft.position.set(0, 0, HEIGHT_MIN + span / 2);
    gizmo.handle.position.set(0, 0, clamped);
    gizmo.group.position.set(base.x, base.y, 0);
    gizmo.group.updateMatrixWorld(true);
  }

  function pickHeightGizmo(event: PointerEvent): boolean {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const gizmo = heightGizmoRef.current;
    if (!renderer || !camera || !gizmo || !gizmo.group.visible) {
      return false;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    pointerRef.current.set(x, y);
    raycasterRef.current.setFromCamera(pointerRef.current, camera);
    const intersects = raycasterRef.current.intersectObjects([gizmo.handle, gizmo.shaft], false);
    return intersects.length > 0;
  }

  function maybeStartHeightDrag(event: PointerEvent): boolean {
    const mode = callbacksRef.current.interactionMode;
    if (mode !== "initialPose" && mode !== "goalPose") {
      return false;
    }
    if (!poseBaseRef.current) {
      return false;
    }

    const hit = pickHeightGizmo(event);
    if (!hit) {
      return false;
    }

    const projected = heightFromPointer(event);
    if (projected === undefined) {
      return false;
    }

    heightDragOffsetRef.current = poseHeightRef.current - projected;

    heightDragActiveRef.current = true;
    clickStateRef.current = undefined;
    if (controlsRef.current) {
      controlsRef.current.enabled = false;
    }
    return true;
  }

  function finishHeightDrag(): void {
    heightDragActiveRef.current = false;
    heightDragOffsetRef.current = 0;
    if (controlsRef.current) {
      controlsRef.current.enabled = true;
    }
  }

  function updateHeightFromPointer(event: PointerEvent): void {
    const base = poseBaseRef.current;
    if (!base) {
      return;
    }

    const projected = heightFromPointer(event);
    if (projected === undefined) {
      return;
    }
    const desired = projected + heightDragOffsetRef.current;
    const clamped = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, desired));
    setInteractionPlaneHeight(clamped);
    base.z = clamped;
    updateHeightGizmo(clamped);
    const preview = previewRef.current;
    if (preview) {
      preview.group.position.set(base.x, base.y, base.z);
      const direction = poseDirectionRef.current ? poseDirectionRef.current.clone() : new Vector3(1, 0, 0);
      const length = poseDirectionRef.current ? Math.max(posePreviewLengthRef.current, 0.05) : 0.3;
      updatePreviewArrow(preview, direction, length);
      preview.group.visible = true;
      preview.group.updateMatrixWorld(true);
    }
  }

  function heightFromPointer(event: PointerEvent): number | undefined {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const base = poseBaseRef.current;
    if (!renderer || !camera || !base) {
      return undefined;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    pointerRef.current.set(x, y);
    raycasterRef.current.setFromCamera(pointerRef.current, camera);

    const rayOrigin = raycasterRef.current.ray.origin;
    const rayDir = raycasterRef.current.ray.direction;
    const axisPoint = new Vector3(base.x, base.y, HEIGHT_MIN);
    const axisDir = new Vector3(0, 0, 1);

    const w0 = rayOrigin.clone().sub(axisPoint);
    const a = rayDir.dot(rayDir);
    const b = rayDir.dot(axisDir);
    const c = axisDir.dot(axisDir);
    const d = rayDir.dot(w0);
    const e = axisDir.dot(w0);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-6) {
      return undefined;
    }
    const t = (a * e - b * d) / denom;
    if (!Number.isFinite(t)) {
      return undefined;
    }
    return Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, t));
  }

  function handlePointerDown(event: PointerEvent): void {
    if (maybeStartHeightDrag(event)) {
      event.preventDefault();
      return;
    }
    const { interactionMode: mode, publishingEnabled } = callbacksRef.current;
    if (!publishingEnabled || mode === "none") {
      clickStateRef.current = undefined;
      return;
    }

    if (event.button === 0) {
      clickStateRef.current = {
        pointerId: event.pointerId,
        button: event.button,
        downPos: new Vector2(event.clientX, event.clientY),
        downTime: performance.now(),
        isDragging: false,
      };
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    if (heightDragActiveRef.current) {
      event.preventDefault();
      updateHeightFromPointer(event);
      return;
    }
    const tracker = clickStateRef.current;
    if (tracker && tracker.pointerId === event.pointerId && tracker.button === 0) {
      const dx = event.clientX - tracker.downPos.x;
      const dy = event.clientY - tracker.downPos.y;
      if (!tracker.isDragging && Math.hypot(dx, dy) > 4) {
        tracker.isDragging = true;
      }
    }

    const mode = callbacksRef.current.interactionMode;
    if (mode !== "initialPose" && mode !== "goalPose") {
      return;
    }
    if (!poseBaseRef.current) {
      return;
    }
    const preview = previewRef.current;
    if (!preview) {
      return;
    }
    const point = pickPointOnPlane(event);
    if (!point) {
      return;
    }
    const direction = point.clone().sub(poseBaseRef.current);
    const length = direction.length();
    if (length < 1e-3) {
      return;
    }
    direction.normalize();
    poseDirectionRef.current = direction.clone();
    posePreviewLengthRef.current = Math.max(length, 0.05);
    updatePreviewArrow(preview, direction, posePreviewLengthRef.current);
    preview.group.position.copy(poseBaseRef.current);
    preview.group.visible = true;
    preview.group.updateMatrixWorld(true);
  }

  function handlePointerUp(event: PointerEvent): void {
    if (heightDragActiveRef.current) {
      if (event.button === 0) {
        event.preventDefault();
        finishHeightDrag();
      }
      return;
    }
    const tracker = clickStateRef.current;
    if (!tracker || tracker.pointerId !== event.pointerId || tracker.button !== event.button) {
      return;
    }
    const elapsed = performance.now() - tracker.downTime;
    const isClick = !tracker.isDragging && elapsed < 500;
    clickStateRef.current = undefined;
    if (!isClick || event.button !== 0) {
      return;
    }

    const { interactionMode: mode, publishingEnabled } = callbacksRef.current;
    if (!publishingEnabled || mode === "none") {
      return;
    }
    const point = pickPointOnPlane(event);
    if (!point) {
      return;
    }
    handleInteractionClick(point, mode, event);
  }

  function handleInteractionClick(point: Vector3, mode: InteractionMode, sourceEvent?: PointerEvent): void {
    if (mode === "clickedPoint") {
      props.onPublishPoint({ x: point.x, y: point.y, z: point.z });
      return;
    }

    if (mode === "initialPose" || mode === "goalPose") {
      const base = poseBaseRef.current;
      if (!base) {
        const projected = sourceEvent ? pickPointOnPlane(sourceEvent, 0) : undefined;
        const zeroBase = projected ?? new Vector3(point.x, point.y, 0);
        poseBaseRef.current = zeroBase;
        setInteractionPlaneHeight(0);
        poseDirectionRef.current = undefined;
        posePreviewLengthRef.current = 0.3;
        heightDragOffsetRef.current = 0;
        showPreviewAtBase(zeroBase);
        showHeightGizmo(zeroBase);
        return;
      }

      const direction = point.clone().sub(base);
      const length = direction.length();
      if (length < 1e-3) {
        return;
      }
      direction.normalize();
      const preview = previewRef.current;
      if (preview) {
        updatePreviewArrow(preview, direction, length);
      }
      props.onPublishPose(mode, {
        position: { x: base.x, y: base.y, z: base.z },
        yaw: Math.atan2(direction.y, direction.x),
      });
      poseBaseRef.current = undefined;
      poseDirectionRef.current = undefined;
      hidePreviewArrow();
      hideHeightGizmo();
    }
  }

  function pickPointOnPlane(event: PointerEvent, overrideHeight?: number): Vector3 | undefined {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) {
      return undefined;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    pointerRef.current.set(x, y);

    raycasterRef.current.setFromCamera(pointerRef.current, camera);
    const target = new Vector3();
    const plane = overrideHeight !== undefined ? new Plane(new Vector3(0, 0, 1), -overrideHeight) : planeRef.current;
    const intersection = raycasterRef.current.ray.intersectPlane(plane, target);
    if (!intersection) {
      return undefined;
    }
    return target.clone();
  }

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}

function createLabelSprite(text: string): Sprite {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return new Sprite();
  }

  const padding = 6;
  context.font = "18px sans-serif";
  const metrics = context.measureText(text);
  const width = Math.ceil(metrics.width) + padding * 2;
  const height = 32;
  canvas.width = width;
  canvas.height = height;

  context.font = "18px sans-serif";
  context.fillStyle = "rgba(5, 5, 10, 0.8)";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.textBaseline = "middle";
  context.fillText(text, padding, height / 2);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new Sprite(material);
  sprite.scale.set(width / 150, height / 150, 1);
  return sprite;
}

const baseDirection = new Vector3(0, 1, 0);
const tempQuaternion = new Quaternion();

function createPreviewArrow(): PreviewArrow {
  const group = new Group();
  group.visible = false;

  const bodyGeometry = new CylinderGeometry(PREVIEW_BODY_RADIUS, PREVIEW_BODY_RADIUS, 1, 24);
  bodyGeometry.translate(0, 0.5, 0);
  const headGeometry = new ConeGeometry(PREVIEW_BODY_RADIUS * 1.8, 1, 32);
  headGeometry.translate(0, 0.5, 0);
  const ringGeometry = new CylinderGeometry(PREVIEW_BODY_RADIUS * 1.1, PREVIEW_BODY_RADIUS * 1.1, 0.05, 24);

  const bodyMaterial = new MeshBasicMaterial({ color: PREVIEW_COLOR });
  const headMaterial = new MeshBasicMaterial({ color: PREVIEW_HIGHLIGHT_COLOR });
  const ringMaterial = new MeshBasicMaterial({ color: 0xffffff });

  const body = new Mesh(bodyGeometry, bodyMaterial);
  const head = new Mesh(headGeometry, headMaterial);
  const ring = new Mesh(ringGeometry, ringMaterial);

  ring.position.y = 0;
  group.add(body, head, ring);

  return {
    group,
    body,
    head,
    ring,
    dispose: () => {
      bodyGeometry.dispose();
      headGeometry.dispose();
      ringGeometry.dispose();
      bodyMaterial.dispose();
      headMaterial.dispose();
      ringMaterial.dispose();
    },
  };
}

function updatePreviewArrow(preview: PreviewArrow, direction: Vector3, length: number): void {
  const headLength = Math.max(PREVIEW_HEAD_MIN, Math.min(length * PREVIEW_HEAD_RATIO, length * 0.6));
  const bodyLength = Math.max(length - headLength, PREVIEW_BODY_MIN);

  preview.body.scale.set(1, bodyLength, 1);
  preview.body.position.y = bodyLength / 2;

  preview.head.scale.set(1, headLength, 1);
  preview.head.position.y = bodyLength + headLength / 2;

  preview.ring.scale.set(1, 1, 1);
  preview.ring.position.y = 0;

  tempQuaternion.setFromUnitVectors(baseDirection, direction);
  preview.group.setRotationFromQuaternion(tempQuaternion);
}

function createHeightGizmo(): HeightGizmo {
  const group = new Group();
  group.visible = false;

  const shaftGeometry = new BoxGeometry(0.04, 0.04, 1);
  const shaftMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
  const shaft = new Mesh(shaftGeometry, shaftMaterial);

  const handleGeometry = new SphereGeometry(0.16, 32, 20);
  const handleMaterial = new MeshBasicMaterial({ color: PREVIEW_COLOR });
  const handle = new Mesh(handleGeometry, handleMaterial);

  group.add(shaft, handle);

  return {
    group,
    shaft,
    handle,
    dispose: () => {
      shaftGeometry.dispose();
      shaftMaterial.dispose();
      handleGeometry.dispose();
      handleMaterial.dispose();
    },
  };
}

function disposeFrame(group: Group): void {
  group.traverse((object) => {
    if (object instanceof Sprite) {
      const material = object.material as SpriteMaterial;
      material.map?.dispose();
      material.dispose();
    } else if (object instanceof AxesHelper) {
      const material = object.material;
      if (Array.isArray(material)) {
        material.forEach((mat) => (mat as LineBasicMaterial).dispose());
      } else {
        (material as LineBasicMaterial).dispose();
      }
    }
  });
}
