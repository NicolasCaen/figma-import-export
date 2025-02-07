// This shows the HTML page in "ui.html".
figma.showUI(__html__);

// Calls to "parent.postMessage" from within the HTML page will trigger this callback.
figma.ui.onmessage = msg => {
  // One way of distinguishing between different types of messages sent from the UI.
  if (msg.type === 'export') {
    (async () => {
      const allVariables = await figma.variables.getLocalVariablesAsync();
      const variableCollections = await figma.variables.getLocalVariableCollectionsAsync();

      // Create a map of collection IDs to collection data (name and modes)
      const collectionDataMap = new Map();
      variableCollections.forEach(collection => {
        collectionDataMap.set(collection.id, {
          name: collection.name,
          modes: collection.modes.map(mode => ({
            modeId: mode.modeId,
            name: mode.name,
          })),
        });
      });

      if (allVariables.length === 0) {
        figma.notify("No local variables found.");
        figma.ui.postMessage({ type: 'export-data', data: '[]' }); // Send empty array
        return;
      }

      const exportData = allVariables.map(variable => {
        const collectionData = collectionDataMap.get(variable.variableCollectionId);
        const collectionName = collectionData ? collectionData.name : "Unnamed Collection";
        const collectionModes = collectionData ? collectionData.modes : [];

        return {
          id: variable.id,
          name: variable.name,
          description: variable.description,
          variableCollectionId: variable.variableCollectionId,
          variableCollectionName: collectionName,
          variableCollectionModes: collectionModes,
          type: variable.resolvedType,
          valuesByMode: variable.valuesByMode,
        };
      });

      const json = JSON.stringify(exportData);
      figma.ui.postMessage({ type: 'export-data', data: json });
    })();
  }

  if (msg.type === 'import') {
    (async () => {
      try {
        const data = JSON.parse(msg.data);

        // Create a map of collection IDs to collections
        const collectionMap = new Map();
        const aliasMap = new Map(); // Store created alias variables

        // First, create all collections and modes
        for (const variableData of data) {
          let collection = collectionMap.get(variableData.variableCollectionId);

          if (!collection) {
            // Create the variable collection if it doesn't exist
            const collectionName = variableData.variableCollectionName || "Unnamed Collection";
            collection = figma.variables.createVariableCollection(collectionName);
            collectionMap.set(variableData.variableCollectionId, collection);

            // Create the modes (up to 4)
            if (variableData.variableCollectionModes) {
              variableData.variableCollectionModes.slice(0, 4).forEach((mode, index) => {
                const existingMode = collection.modes.find(m => m.modeId === mode.modeId);
                if (!existingMode) {
                  if (index === 0 && collection.modes.length > 0) {
                    collection.renameMode(collection.modes[0].modeId, mode.name);
                  } else {
                    try {
                      collection.addMode(mode.name);
                    } catch (e) {
                      console.warn(`Could not add mode ${mode.name} to collection ${collectionName}: ${e}`);
                    }
                  }
                }
              });
            }
          }
        }

        // Then, create variables and assign values
        for (const variableData of data) {
          let collection = collectionMap.get(variableData.variableCollectionId);

          // Create the variable
          const variable = figma.variables.createVariable(
            variableData.name,
            collection,
            variableData.type
          );
          variable.description = variableData.description;

          // Set the values for each mode
          if (variableData.valuesByMode) {
            for (const modeId in variableData.valuesByMode) {
              let value = variableData.valuesByMode[modeId];
              const existingMode = collection.modes.find(m => m.modeId === modeId);

              if (!existingMode) {
                console.warn(`Mode with id ${modeId} not found in collection ${collection.name}. Skipping value assignment.`);
                continue;
              }

              if (variableData.type === "COLOR") {
                if (typeof value === 'object' && value !== null && value.hasOwnProperty('type') && value.type === 'VARIABLE_ALIAS') {
                  // Handle alias
                  try {
                    let aliasVariable = aliasMap.get(value.id);
                    if (!aliasVariable) {
                      aliasVariable = await figma.variables.getVariableByIdAsync(value.id);
                      if (aliasVariable) {
                        aliasMap.set(value.id, aliasVariable);
                      } else {
                        console.warn(`Alias variable with id ${value.id} not found`);
                        continue; // Skip this value if alias not found
                      }
                    }
                    variable.setValueForMode(modeId, { type: 'VARIABLE_ALIAS', variableId: aliasVariable.id });
                  } catch (err) {
                    console.warn(`Failed to set alias value for mode ${modeId} on variable ${variable.name}: ${err}`);
                  }


                }
                else if (typeof value === 'object' && value !== null && value.hasOwnProperty('r')) {
                  // Handle r, g, b, a
                  variable.setValueForMode(modeId, value);
                }
              }
              else {
                variable.setValueForMode(modeId, value);
              }
            }
          }
        }

        figma.notify('Variables imported successfully!');
      } catch (error) {
        figma.notify('Error importing variables: ' + error.message);
      }
    })();
  }

  // Make sure to close the plugin when you're done. Otherwise the plugin will
  // keep running, which shows the cancel button at the bottom of the screen.
  // figma.closePlugin();
};
