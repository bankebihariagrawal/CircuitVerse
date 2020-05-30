/* eslint-disable import/no-cycle */
/* eslint-disable no-bitwise */
/* eslint-disable guard-for-in */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-restricted-globals */
/* eslint-disable consistent-return */
/* eslint-disable func-names */
/* eslint-disable array-callback-return */
/* eslint-disable no-use-before-define */
/* eslint-disable no-param-reassign */
/* eslint-disable no-alert */
import CircuitElement from './circuitElement';
import simulationArea from './simulationArea';
import { changeClockTime } from './simulationArea';
import { stripTags, uniq, showMessage, showError } from './utils';
import { findDimensions, dots } from './canvasApi';
import { updateRestrictedElementsList } from './restrictedElementDiv';
import { scheduleBackup } from './data/backupCircuit';
import { showProperties } from './ux';
import { scheduleUpdate } from './engine';
import { toggleLayoutMode } from './layoutMode';
import { setProjectName } from './data/save';
import { changeClockEnable } from './sequential';
import { changeInputSize } from './modules';

export const circuitProperty = { toggleLayoutMode, setProjectName, changeCircuitName, changeClockTime, deleteCurrentCircuit, changeClockEnable, changeInputSize };
// export circuitProperty;

/**
 * Function used to change the current focusedCircuit
 * Disables layoutMode if enabled
 * Changes UI tab etc
 * Sets flags to make updates, resets most of the things
 * @param {string} id - identifier for circuit
 */
export function switchCircuit(id) {
    if (layoutMode) { toggleLayoutMode(); }

    // globalScope.fixLayout();
    scheduleBackup();
    if (id === globalScope.id) return;
    $(`#${globalScope.id}`).removeClass('current');
    $(`#${id}`).addClass('current');
    simulationArea.lastSelected = undefined;
    simulationArea.multipleObjectSelections = [];
    simulationArea.copyList = [];
    globalScope = scopeList[id];
    updateSimulation = true;
    updateSubcircuit = true;
    forceResetNodes = true;
    dots(false);
    simulationArea.lastSelected = globalScope.root;
    if (!embed) {
        showProperties(simulationArea.lastSelected);
    }
    updateCanvas = true;
    scheduleUpdate();

    // to update the restricted elements information
    updateRestrictedElementsList();
}

/**
 * Deletes the current circuit
 * Ensures that at least one circuit is there
 * Ensures that no circuit depends on the current circuit
 * Switched to a random circuit
 */
function deleteCurrentCircuit(scopeId = globalScope.id) {
    const scope = scopeList[scopeId];
    if (Object.keys(scopeList).length <= 1) {
        showError('At least 2 circuits need to be there in order to delete a circuit.');
        return;
    }
    let dependencies = '';
    for (id in scopeList) {
        if (id != scope.id && scopeList[id].checkDependency(scope.id)) {
            if (dependencies === '') {
                dependencies = scopeList[id].name;
            } else {
                dependencies += `, ${scopeList[id].name}`;
            }
        }
    }
    if (dependencies) {
        dependencies = `\nThe following circuits are depending on '${scope.name}': ${dependencies}\nDelete subcircuits of ${scope.name} before trying to delete ${scope.name}`;
        alert(dependencies);
        return;
    }

    const confirmation = confirm(`Are you sure want to delete: ${scope.name}\nThis cannot be undone.`);
    if (confirmation) {
        $(`#${scope.id}`).remove();
        delete scopeList[scope.id];
        switchCircuit(Object.keys(scopeList)[0]);
        showMessage('Circuit was successfully deleted');
    } else { showMessage('Circuit was not deleted'); }
}

/**
 * Function to create new circuit
 * Function creates button in tab, creates scope and switches to this circuit
 * @param {string} name - name of the new circuit
 * @param {string} id - identifier for circuit
 */
export function newCircuit(name, id) {
    name = name || prompt('Enter circuit name:');
    name = stripTags(name);
    if (!name) return;
    const scope = new Scope(name);
    if (id) scope.id = id;
    scopeList[scope.id] = scope;
    globalScope = scope;
    $('.circuits').removeClass('current');
    $('#tabsBar').append(`<div class='circuits toolbarButton current' id='${scope.id}'>${name}<span class ='tabsCloseButton' id='${scope.id}'  ><i class="fa fa-times"></i></span></div>`);
    $('.circuits').click(function () {
        switchCircuit(this.id);
    });
    $('.tabsCloseButton').click(function (e) {
        e.stopPropagation();
        deleteCurrentCircuit(this.id);
    });
    if (!embed) {
        showProperties(scope.root);
    }
    dots(false);
    return scope;
}

/**
 * Used to change name of a circuit
 * @param {string} name - new name
 * @param {string} id - id of the circuit
 */
export function changeCircuitName(name, id = globalScope.id) {
    name = name || 'Untitled';
    name = stripTags(name);
    $(`#${id}`).html(name);
    scopeList[id].name = name;
}

/**
 * Constructor for a circuit
 * @class
 * @param {string} name - name of the circuit
 * @param {number=} id - a random id for the circuit
 */
export default class Scope {
    constructor(name = 'localScope', id = undefined) {
        this.restrictedCircuitElementsUsed = [];
        this.id = id || Math.floor((Math.random() * 100000000000) + 1);
        this.CircuitElement = [];

        // root object for referring to main canvas - intermediate node uses this
        this.root = new CircuitElement(0, 0, this, 'RIGHT', 1);
        this.backups = [];
        this.timeStamp = new Date().getTime();

        this.ox = 0;
        this.oy = 0;
        this.scale = DPR;
        this.tunnelList = {};
        this.stack = [];

        this.name = name;
        this.pending = [];
        this.nodes = []; // intermediate nodes only
        this.allNodes = [];
        this.wires = [];

        // Creating arrays for other module elements
        for (let i = 0; i < moduleList.length; i++) {
            this[moduleList[i]] = [];
        }

        // Setting default layout
        this.layout = { // default position
            width: 100,
            height: 40,
            title_x: 50,
            title_y: 13,
            titleEnabled: true,
        };


        // FOR SOME UNKNOWN REASON, MAKING THE COPY OF THE LIST COMMON
        // TO ALL SCOPES EITHER BY PROTOTYPE OR JUST BY REFERNCE IS CAUSING ISSUES
        // The issue comes regarding copy/paste operation, after 5-6 operations it becomes slow for unknown reasons
        // CHANGE/ REMOVE WITH CAUTION
        // this.objects = ["wires", ...circuitElementList, "nodes", ...annotationList];
        // this.renderObjectOrder = [ ...(moduleList.slice().reverse()), "wires", "allNodes"];
    }

    // Resets all nodes recursively
    reset() {
        for (let i = 0; i < this.allNodes.length; i++) { this.allNodes[i].reset(); }
        for (let i = 0; i < this.Splitter.length; i++) {
            this.Splitter[i].reset();
        }
        for (let i = 0; i < this.SubCircuit.length; i++) {
            this.SubCircuit[i].reset();
        }
    }

    // Adds all inputs to simulationQueue
    addInputs() {
        for (let i = 0; i < inputList.length; i++) {
            for (var j = 0; j < this[inputList[i]].length; j++) {
                simulationArea.simulationQueue.add(this[inputList[i]][j], 0);
            }
        }

        for (let i = 0; i < this.SubCircuit.length; i++) { this.SubCircuit[i].addInputs(); }
    }

    // Ticks clocks recursively -- needs to be deprecated and synchronize all clocks with a global clock
    clockTick() {
        for (let i = 0; i < this.Clock.length; i++) { this.Clock[i].toggleState(); } // tick clock!
        for (let i = 0; i < this.SubCircuit.length; i++) { this.SubCircuit[i].localScope.clockTick(); } // tick clock!
    }

    // Checks if this circuit contains directly or indirectly scope with id
    // Recursive nature
    checkDependency(id) {
        if (id === this.id) return true;
        for (let i = 0; i < this.SubCircuit.length; i++) { if (this.SubCircuit[i].id === id) return true; }

        for (let i = 0; i < this.SubCircuit.length; i++) { if (scopeList[this.SubCircuit[i].id].checkDependency(id)) return true; }

        return false;
    }

    // Get dependency list - list of all circuits, this circuit depends on
    getDependencies() {
        var list = [];
        for (let i = 0; i < this.SubCircuit.length; i++) {
            list.push(this.SubCircuit[i].id);
            list.extend(scopeList[this.SubCircuit[i].id].getDependencies());
        }
        return uniq(list);
    }

    // helper function to reduce layout size
    fixLayout() {
        var maxY = 20;
        for (let i = 0; i < this.Input.length; i++) { maxY = Math.max(this.Input[i].layoutProperties.y, maxY); }
        for (let i = 0; i < this.Output.length; i++) { maxY = Math.max(this.Output[i].layoutProperties.y, maxY); }
        if (maxY !== this.layout.height) { this.layout.height = maxY + 10; }
    }

    // Function which centers the circuit to the correct zoom level
    centerFocus(zoomIn = true) {
        if (layoutMode) return;
        findDimensions(this);
        var minX = simulationArea.minWidth || 0;
        var minY = simulationArea.minHeight || 0;
        var maxX = simulationArea.maxWidth || 0;
        var maxY = simulationArea.maxHeight || 0;

        var reqWidth = maxX - minX + 150;
        var reqHeight = maxY - minY + 150;

        this.scale = Math.min(width / reqWidth, height / reqHeight);

        if (!zoomIn) { this.scale = Math.min(this.scale, DPR); }
        this.scale = Math.max(this.scale, DPR / 10);

        this.ox = (-minX) * this.scale + (width - (maxX - minX) * this.scale) / 2;
        this.oy = (-minY) * this.scale + (height - (maxY - minY) * this.scale) / 2;
    }
}
