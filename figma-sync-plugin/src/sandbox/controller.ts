figma.showUI(__html__, { width: 400, height: 600 });

figma.ui.onmessage = (msg: { type: string }) => {
  console.log("Received message:", msg.type);
};
