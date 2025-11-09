import {
  Immutable,
  MessageEvent,
  PanelExtensionContext,
  SettingsTree,
  SettingsTreeAction,
  SettingsTreeFields,
  Subscription,
  Time,
  Topic,
} from "@foxglove/extension";
import { MessageDefinition } from "@foxglove/message-definition";
import {
  Dispatch,
  ReactElement,
  SetStateAction,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { Matrix4 } from "three";

import { InteractionMode } from "./interaction";
import { DEFAULT_CONFIG, PanelConfig } from "./panelState";
import { ThreeScene } from "./ThreeScene";
import { ParsedPointCloud, parsePointCloud2 } from "./pointcloud";
import type { FramePose, PointCloudRenderable, Vec3 } from "./sceneTypes";
import { TfStore } from "./tfStore";

import {
  ros1,
  ros2galactic,
  ros2humble,
  ros2iron,
  ros2jazzy,
} from "@foxglove/rosmsg-msgs-common";

type SceneData = {
  pointClouds: PointCloudRenderable[];
  frames: FramePose[];
};

const DEFAULT_SCENE: SceneData = { pointClouds: [], frames: [] };

const DATATYPE_REQUIREMENTS: Record<string, string[]> = {
  "geometry_msgs/PoseStamped": [
    "geometry_msgs/PoseStamped",
    "std_msgs/Header",
    "geometry_msgs/Pose",
    "geometry_msgs/Point",
    "geometry_msgs/Quaternion",
  ],
  "geometry_msgs/PoseWithCovarianceStamped": [
    "geometry_msgs/PoseWithCovarianceStamped",
    "std_msgs/Header",
    "geometry_msgs/PoseWithCovariance",
    "geometry_msgs/Pose",
    "geometry_msgs/Point",
    "geometry_msgs/Quaternion",
  ],
  "geometry_msgs/PointStamped": [
    "geometry_msgs/PointStamped",
    "std_msgs/Header",
    "geometry_msgs/Point",
  ],
};

const INITIAL_COVARIANCE: number[] = (() => {
  const values = new Array(36).fill(0);
  values[0] = 0.25;
  values[7] = 0.25;
  values[35] = (Math.PI / 12) ** 2;
  return values;
})();

export function initScenePanel(context: PanelExtensionContext): () => void {
  const root = createRoot(context.panelElement);
  root.render(<ScenePanel context={context} />);
  return () => root.unmount();
}

function ScenePanel({ context }: { context: PanelExtensionContext }): ReactElement {
  const initialState = useMemo(() => mergeConfig(DEFAULT_CONFIG, context.initialState), [context.initialState]);
  const [config, setConfig] = useState<PanelConfig>(initialState);
  const [topics, setTopics] = useState<Immutable<Topic[]>>();
  const [currentFrame, setCurrentFrame] = useState<Immutable<MessageEvent[]>>();
  const [colorScheme, setColorScheme] = useState<"dark" | "light">("dark");
  const [currentTime, setCurrentTime] = useState<Time | undefined>(undefined);
  const [sceneData, setSceneData] = useState<SceneData>(DEFAULT_SCENE);
  const [availableFrames, setAvailableFrames] = useState<string[]>([initialState.fixedFrame]);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("none");
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();
  const [pointCloudVersion, setPointCloudVersion] = useState(0);
  const [tfVersion, setTfVersion] = useState(0);

  const tfStoreRef = useRef(new TfStore());
  const pointCloudStoreRef = useRef<Map<string, ParsedPointCloud>>(new Map());

  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      if (renderState.didSeek) {
        pointCloudStoreRef.current.clear();
        tfStoreRef.current.resetDynamic();
        setPointCloudVersion((value) => value + 1);
        setTfVersion((value) => value + 1);
      }

      setRenderDone(() => done);
      setTopics(renderState.topics);
      setCurrentFrame(renderState.currentFrame);
      setColorScheme(renderState.colorScheme ?? "dark");
      setCurrentTime(renderState.currentTime);
    };

    context.watch("topics");
    context.watch("currentFrame");
    context.watch("colorScheme");
    context.watch("currentTime");
    context.watch("didSeek");
  }, [context]);

  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  useEffect(() => {
    context.saveState(config);
  }, [context, config]);

  useEffect(() => {
    const subscriptions: Subscription[] = [];
    for (const topic of config.pointCloudTopics) {
      if (topic) {
        subscriptions.push({ topic });
      }
    }
    if (config.tfTopic) {
      subscriptions.push({ topic: config.tfTopic });
    }
    if (config.tfStaticTopic && config.tfStaticTopic !== config.tfTopic) {
      subscriptions.push({ topic: config.tfStaticTopic });
    }

    context.unsubscribeAll();
    if (subscriptions.length > 0) {
      context.subscribe(subscriptions);
    }

    return () => {
      context.unsubscribeAll();
    };
  }, [context, config.pointCloudTopics, config.tfStaticTopic, config.tfTopic]);

  useEffect(() => {
    if (!currentFrame || currentFrame.length === 0) {
      return;
    }

    let cloudsChanged = false;
    let tfChanged = false;

    for (const event of currentFrame) {
      if (!event) {
        continue;
      }
      if (config.pointCloudTopics.includes(event.topic) && isPointCloudSchema(event.schemaName)) {
        const parsed = parsePointCloud2(event.topic, event.message as never);
        if (parsed) {
          pointCloudStoreRef.current.set(event.topic, parsed);
          cloudsChanged = true;
        }
      } else if (event.topic === config.tfTopic) {
        tfChanged = tfStoreRef.current.update(event.message as never, false) || tfChanged;
      } else if (event.topic === config.tfStaticTopic) {
        tfChanged = tfStoreRef.current.update(event.message as never, true) || tfChanged;
      }
    }

    if (cloudsChanged) {
      setPointCloudVersion((value) => value + 1);
    }
    if (tfChanged) {
      setTfVersion((value) => value + 1);
    }
  }, [config.pointCloudTopics, config.tfStaticTopic, config.tfTopic, currentFrame]);

  useEffect(() => {
    const tfData = tfStoreRef.current.buildPoseData(config.fixedFrame);
    const matrixMap = tfData.matrixMap;

    const clouds: PointCloudRenderable[] = [];
    for (const cloud of pointCloudStoreRef.current.values()) {
      clouds.push({
        id: cloud.id,
        frameId: cloud.frameId,
        positions: cloud.positions,
        colors: cloud.colors,
        matrix: (matrixMap.get(cloud.frameId) ?? new Matrix4()).clone(),
      });
    }

    setSceneData({ pointClouds: clouds, frames: tfData.frames });

    const frameList = tfStoreRef.current.listFrames([
      config.fixedFrame,
      ...clouds.map((cloud) => cloud.frameId),
    ]);
    setAvailableFrames(frameList.length > 0 ? frameList : [config.fixedFrame]);
  }, [config.fixedFrame, pointCloudVersion, tfVersion]);

  useEffect(() => {
    if (!context.advertise || !context.publish) {
      return;
    }
    const pairs: Array<{ topic: string; schema: string }> = [
      { topic: config.interactionTopics.initialPose, schema: "geometry_msgs/PoseWithCovarianceStamped" },
      { topic: config.interactionTopics.goalPose, schema: "geometry_msgs/PoseStamped" },
      { topic: config.interactionTopics.clickedPoint, schema: "geometry_msgs/PointStamped" },
    ].filter((item) => item.topic);

    for (const pair of pairs) {
      const options = buildAdvertiseOptions(pair.schema, context.dataSourceProfile);
      context.advertise(pair.topic, pair.schema, options);
    }

    return () => {
      for (const pair of pairs) {
        context.unadvertise?.(pair.topic);
      }
    };
  }, [config.interactionTopics, context]);

  const topicList = useMemo(() => (topics ? [...topics] : []), [topics]);
  const pointCloudTopicOptions = useMemo(
    () => topicList.filter((topic) => isPointCloudSchema(topic.schemaName)).map((topic) => topic.name),
    [topicList],
  );
  const tfTopicOptions = useMemo(
    () => topicList.filter((topic) => topic.schemaName === "tf2_msgs/TFMessage").map((topic) => topic.name),
    [topicList],
  );
  const allPointCloudSettingsTopics = useMemo(
    () => unique([...config.pointCloudTopics, ...pointCloudTopicOptions]),
    [config.pointCloudTopics, pointCloudTopicOptions],
  );
  const tfSettingsTopics = useMemo(
    () => unique([config.tfTopic, config.tfStaticTopic, ...tfTopicOptions]),
    [config.tfTopic, config.tfStaticTopic, tfTopicOptions],
  );
  useEffect(() => {
    const settingsTree = buildSettingsTree({
      config,
      frames: availableFrames,
      pointCloudTopics: allPointCloudSettingsTopics,
      tfTopics: tfSettingsTopics,
      setConfig,
    });
    context.updatePanelSettingsEditor(settingsTree);
  }, [allPointCloudSettingsTopics, availableFrames, config, context, setConfig, tfSettingsTopics]);

  const publishingAvailable = Boolean(context.publish);
  const fixedFrame = config.fixedFrame || "map";

  const handlePointPublish = (point: Vec3): void => {
    if (!context.publish || !config.interactionTopics.clickedPoint) {
      return;
    }
    const header = {
      frame_id: fixedFrame,
      stamp: currentTime ?? nowAsTime(),
    };
    context.publish(config.interactionTopics.clickedPoint, {
      header,
      point,
    });
  };

  const handlePosePublish = (
    mode: Extract<InteractionMode, "initialPose" | "goalPose">,
    payload: { position: Vec3; yaw: number },
  ): void => {
    if (!context.publish) {
      return;
    }

    const header = {
      frame_id: fixedFrame,
      stamp: currentTime ?? nowAsTime(),
    };
    const orientation = yawToQuaternion(payload.yaw);

    if (mode === "initialPose" && config.interactionTopics.initialPose) {
      context.publish(config.interactionTopics.initialPose, {
        header,
        pose: {
          pose: {
            position: payload.position,
            orientation,
          },
          covariance: INITIAL_COVARIANCE,
        },
      });
    } else if (mode === "goalPose" && config.interactionTopics.goalPose) {
      context.publish(config.interactionTopics.goalPose, {
        header,
        pose: {
          position: payload.position,
          orientation,
        },
      });
    }
  };

  const interactionButtons = [
    {
      mode: "initialPose" as InteractionMode,
      title: "2D Pose Estimate",
      subtitle: config.interactionTopics.initialPose,
      icon: "pose",
    },
    {
      mode: "goalPose" as InteractionMode,
      title: "2D Pose Goal",
      subtitle: config.interactionTopics.goalPose,
      icon: "goal",
    },
    {
      mode: "clickedPoint" as InteractionMode,
      title: "2D Point",
      subtitle: config.interactionTopics.clickedPoint,
      icon: "point",
    },
  ];

  const palette = colorScheme === "dark"
    ? {
        surface: "rgba(12, 13, 22, 0.75)",
        border: "rgba(255,255,255,0.08)",
        text: "#f5f6fb",
        accent: "#4f7cff",
        muted: "rgba(255,255,255,0.45)",
      }
    : {
        surface: "rgba(250, 250, 252, 0.9)",
        border: "rgba(15,18,40,0.08)",
        text: "#1f2430",
        accent: "#335dff",
        muted: "rgba(31,36,48,0.6)",
      };

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        background: colorScheme === "dark" ? "#050608" : "#f5f6f8",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <ThreeScene
        pointClouds={sceneData.pointClouds}
        frames={sceneData.frames}
        fixedFrame={fixedFrame}
        colorScheme={colorScheme}
        interactionMode={interactionMode}
        publishingEnabled={publishingAvailable}
        onPublishPoint={handlePointPublish}
        onPublishPose={handlePosePublish}
      />

      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          padding: "4px 10px",
          borderRadius: 999,
          background: palette.surface,
          color: palette.text,
          fontSize: 12,
          border: `1px solid ${palette.border}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ opacity: 0.7 }}>固定坐标系</span>
        <strong>{fixedFrame}</strong>
      </div>

      <div
        style={{
          position: "absolute",
          top: "50%",
          right: 18,
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          alignItems: "stretch",
        }}
      >
        {interactionButtons.map((button) => {
          const disabled = !publishingAvailable || !button.subtitle;
          const active = interactionMode === button.mode;
          return (
            <button
              key={button.mode}
              type="button"
              onClick={() =>
                setInteractionMode((prev) => (prev === button.mode ? "none" : (button.mode as InteractionMode)))
              }
              disabled={disabled}
              style={{
                width: 180,
                padding: "8px 12px",
                borderRadius: 12,
                background: active ? palette.accent : palette.surface,
                border: `1px solid ${active ? palette.accent : palette.border}`,
                color: palette.text,
                textAlign: "left",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.45 : 1,
                boxShadow: active ? "0 8px 18px rgba(50,90,255,0.35)" : "none",
                transition: "background 120ms, transform 120ms",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{button.title}</div>
              <div style={{ fontSize: 11, color: palette.muted }}>{button.subtitle || "未配置"}</div>
            </button>
          );
        })}
      </div>

      {!publishingAvailable && (
        <div
          style={{
            position: "absolute",
            bottom: 18,
            right: 24,
            padding: "6px 10px",
            borderRadius: 6,
            background: palette.surface,
            color: palette.muted,
            fontSize: 12,
            border: `1px solid ${palette.border}`,
          }}
        >
          当前数据源不支持发布
        </div>
      )}
    </div>
  );
}

function mergeConfig(defaults: PanelConfig, state: unknown): PanelConfig {
  if (!state || typeof state !== "object") {
    return defaults;
  }
  return {
    ...defaults,
    ...(state as Partial<PanelConfig>),
    interactionTopics: {
      ...defaults.interactionTopics,
      ...(state as { interactionTopics?: Partial<PanelConfig["interactionTopics"]> }).interactionTopics,
    },
  };
}

function isPointCloudSchema(schema?: string): boolean {
  return schema === "sensor_msgs/PointCloud2" || schema === "foxglove.PointCloud";
}

function nowAsTime(): Time {
  const now = Date.now();
  return { sec: Math.floor(now / 1000), nsec: (now % 1000) * 1e6 };
}

function yawToQuaternion(yaw: number): { x: number; y: number; z: number; w: number } {
  const half = yaw / 2;
  return {
    x: 0,
    y: 0,
    z: Math.sin(half),
    w: Math.cos(half),
  };
}

function buildAdvertiseOptions(schema: string, profile?: string): Record<string, unknown> | undefined {
  const requirements = DATATYPE_REQUIREMENTS[schema];
  if (!requirements) {
    return undefined;
  }
  const definitionSource = selectDefinitionSource(profile);
  if (!definitionSource) {
    return undefined;
  }
  const datatypes = new Map<string, MessageDefinition>();
  for (const typeName of requirements) {
    const definition = definitionSource[typeName];
    if (definition) {
      datatypes.set(typeName, definition);
    }
  }
  return datatypes.size > 0 ? { datatypes } : undefined;
}

function selectDefinitionSource(profile?: string): DefinitionDictionary {
  if (!profile) {
    return ros1;
  }
  const normalized = profile.toLowerCase();
  if (normalized.includes("ros2")) {
    if (normalized.includes("jazzy")) {
      return ros2jazzy;
    }
    if (normalized.includes("iron")) {
      return ros2iron;
    }
    if (normalized.includes("galactic")) {
      return ros2galactic;
    }
    return ros2humble;
  }
  return ros1;
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
type DefinitionDictionary = Record<string, MessageDefinition>;

type SettingsBuilderArgs = {
  config: PanelConfig;
  frames: string[];
  pointCloudTopics: string[];
  tfTopics: string[];
  setConfig: Dispatch<SetStateAction<PanelConfig>>;
};

function buildSettingsTree(args: SettingsBuilderArgs): SettingsTree {
  const frameItems = unique([...args.frames, "map"]);
  const pointCloudFields: SettingsTreeFields = {};
  for (const topic of args.pointCloudTopics) {
    pointCloudFields[topic] = {
      label: topic,
      input: "boolean",
      value: args.config.pointCloudTopics.includes(topic),
    };
  }

  const tfOptions = buildSelectOptions(args.tfTopics);

  const nodes: SettingsTree["nodes"] = {
    reference: {
      label: "参考系",
      fields: {
        fixedFrame: {
          label: "显示参考系",
          input: "autocomplete",
          value: args.config.fixedFrame,
          items: frameItems,
          placeholder: "map",
        },
      },
    },
    topics: {
      label: "话题",
      children: {
        clouds: {
          label: "场景",
          help: args.pointCloudTopics.length === 0 ? "未检测到点云话题" : undefined,
          fields: pointCloudFields,
        },
        tf: {
          label: "转换",
          fields: {
            tfTopic: {
              label: "TF 流",
              input: "select",
              value: args.config.tfTopic,
              options: tfOptions,
            },
            tfStaticTopic: {
              label: "静态 TF",
              input: "select",
              value: args.config.tfStaticTopic ?? "",
              options: [{ label: "关闭", value: "" }, ...tfOptions],
            },
          },
        },
      },
    },
    publish: {
      label: "发布",
      fields: {
        initialPoseTopic: {
          label: "2D Pose Estimate",
          input: "string",
          value: args.config.interactionTopics.initialPose,
        },
        goalPoseTopic: {
          label: "2D Pose Goal",
          input: "string",
          value: args.config.interactionTopics.goalPose,
        },
        clickedPointTopic: {
          label: "2D Point",
          input: "string",
          value: args.config.interactionTopics.clickedPoint,
        },
      },
    },
  };

  return {
    enableFilter: true,
    nodes,
    actionHandler: (action) => handleSettingsAction(action, args.setConfig),
  };
}

function handleSettingsAction(
  action: SettingsTreeAction,
  setConfig: Dispatch<SetStateAction<PanelConfig>>,
): void {
  if (action.action !== "update") {
    return;
  }
  const path = action.payload.path;
  setConfig((prev) => {
    let next = prev;
    if (path[0] === "reference" && path[1] === "fixedFrame" && typeof action.payload.value === "string") {
      const frame = action.payload.value.trim() || "map";
      if (frame !== prev.fixedFrame) {
        next = { ...prev, fixedFrame: frame };
      }
    } else if (path[0] === "topics" && path[1] === "tf" && path[2] === "tfTopic" && typeof action.payload.value === "string") {
      const topic = action.payload.value || "/tf";
      if (topic !== prev.tfTopic) {
        next = { ...prev, tfTopic: topic };
      }
    } else if (
      path[0] === "topics" &&
      path[1] === "tf" &&
      path[2] === "tfStaticTopic" &&
      typeof action.payload.value === "string"
    ) {
      const topic = action.payload.value || undefined;
      if (topic !== prev.tfStaticTopic) {
        next = { ...prev, tfStaticTopic: topic };
      }
    } else if (
      path[0] === "topics" &&
      path[1] === "clouds" &&
      typeof path[2] === "string" &&
      typeof action.payload.value === "boolean"
    ) {
      const topic = path[2];
      const enabled = action.payload.value;
      const exists = prev.pointCloudTopics.includes(topic);
      if (enabled && !exists) {
        next = { ...prev, pointCloudTopics: [...prev.pointCloudTopics, topic] };
      } else if (!enabled && exists) {
        next = { ...prev, pointCloudTopics: prev.pointCloudTopics.filter((name) => name !== topic) };
      }
    } else if (path[0] === "publish" && typeof action.payload.value === "string") {
      const value = action.payload.value;
      if (path[1] === "initialPoseTopic" && value !== prev.interactionTopics.initialPose) {
        next = {
          ...prev,
          interactionTopics: { ...prev.interactionTopics, initialPose: value },
        };
      } else if (path[1] === "goalPoseTopic" && value !== prev.interactionTopics.goalPose) {
        next = {
          ...prev,
          interactionTopics: { ...prev.interactionTopics, goalPose: value },
        };
      } else if (path[1] === "clickedPointTopic" && value !== prev.interactionTopics.clickedPoint) {
        next = {
          ...prev,
          interactionTopics: { ...prev.interactionTopics, clickedPoint: value },
        };
      }
    }
    return next;
  });
}

function buildSelectOptions(values: string[]): Array<{ label: string; value: string }> {
  const list = values.length > 0 ? values : ["/tf"];
  return list.map((value) => ({ label: value, value }));
}
