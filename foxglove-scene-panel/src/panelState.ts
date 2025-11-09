export type InteractionTopics = {
  initialPose: string;
  goalPose: string;
  clickedPoint: string;
};

export type PanelConfig = {
  pointCloudTopics: string[];
  tfTopic: string;
  tfStaticTopic?: string;
  fixedFrame: string;
  interactionTopics: InteractionTopics;
};

export const DEFAULT_CONFIG: PanelConfig = {
  pointCloudTopics: [],
  tfTopic: "/tf",
  tfStaticTopic: "/tf_static",
  fixedFrame: "map",
  interactionTopics: {
    initialPose: "/initialpose",
    goalPose: "/move_base_simple/goal",
    clickedPoint: "/clicked_point",
  },
};
