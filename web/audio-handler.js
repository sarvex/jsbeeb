import {FakeSoundChip, SoundChip} from "../soundchip.js";
import {DdNoise, FakeDdNoise} from "../ddnoise.js";
import {AudioWorklet} from "audio-worklet";
import {SmoothieChart, TimeSeries} from "smoothie";

export class AudioHandler {
    constructor(warningNode, statsNode, audioFilterFreq, audioFilterQ, noSeek) {
        this.warningNode = warningNode;
        this.warningNode.toggle(false);
        this.chart = new SmoothieChart({
            tooltip: true, labels: {precision: 0}, yRangeFunction: range => {
                return {min: 0, max: range.max};
            }
        });
        this.stats = {};
        this._addStat("queueSize", {strokeStyle: 'rgb(51,126,108)'});
        this._addStat("queueAge", {strokeStyle: 'rgb(162,119,22)'});
        this.chart.streamTo(statsNode, 500);
        /*global webkitAudioContext*/
        this.audioContext = typeof AudioContext !== 'undefined' ? new AudioContext()
            : typeof webkitAudioContext !== 'undefined' ? new webkitAudioContext()
                : null;
        this._jsAudioNode = null;
        if (this.audioContext && this.audioContext.audioWorklet) {
            this.audioContext.onstatechange = () => this.checkStatus();
            this.soundChip = new SoundChip((buffer, time) => this._onBuffer(buffer, time));
            this.ddNoise = noSeek ? new FakeDdNoise() : new DdNoise(this.audioContext);
            this._setup(audioFilterFreq, audioFilterQ).then();
        } else {
            if (this.audioContext && !this.audioContext.audioWorklet) {
                this.audioContext = null;
                console.log("Unable to initialise audio: no audio worklet API");
                this.warningNode.toggle(true);
                const localhost = new URL(window.location);
                localhost.hostname = 'localhost';
                this.warningNode.html(
                    `No audio worklet API was found - there will be no audio. 
                    If you are running a local jsbeeb, you must either use a host of
                    <a href="${localhost}">localhost</a>, 
                    or serve the content over <em>https</em>.`);
            }
            this.soundChip = new FakeSoundChip();
            this.ddNoise = new FakeDdNoise();
        }

        this.warningNode.on('mousedown', () => this.tryResume());
    }

    async _setup(audioFilterFreq, audioFilterQ) {
        await this.audioContext.audioWorklet.addModule(
            new AudioWorklet(
                new URL("./audio-renderer.js", import.meta.url)
            )
        );
        if (audioFilterFreq !== 0) {
            this.soundChip.filterNode = this.audioContext.createBiquadFilter();
            this.soundChip.filterNode.type = "lowpass";
            this.soundChip.filterNode.frequency.value = audioFilterFreq;
            this.soundChip.filterNode.Q.value = audioFilterQ;
            this._audioDestination = this.soundChip.filterNode;
            this.soundChip.filterNode.connect(this.audioContext.destination);
        } else {
            this._audioDestination = this.audioContext.destination;
        }

        this._jsAudioNode = new AudioWorkletNode(this.audioContext, 'sound-chip-processor');
        this._jsAudioNode.connect(this._audioDestination);
        this._jsAudioNode.port.onmessage = (event) => {
            const now = Date.now();
            for (const stat of Object.keys(event.data)) {
                if (this.stats[stat])
                    this.stats[stat].append(now, event.data[stat]);
            }
        }
    }

    _addStat(stat, info) {
        const timeSeries = new TimeSeries();
        this.stats[stat] = timeSeries;
        info.tooltipLabel = stat;
        this.chart.addTimeSeries(timeSeries, info);
    }

    _onBuffer(buffer) {
        if (this._jsAudioNode)
            this._jsAudioNode.port.postMessage({time: Date.now(), buffer}, [buffer.buffer]);
    }

    // Recent browsers, particularly Safari and Chrome, require a user
    // interaction in order to enable sound playback.
    async tryResume() {
        if (this.audioContext)
            await this.audioContext.resume();
    }

    checkStatus() {
        if (!this.audioContext) return;
        if (this.audioContext.state === "suspended") this.warningNode.fadeIn();
        if (this.audioContext.state === "running") this.warningNode.fadeOut();
    }

    async initialise() {
        await this.ddNoise.initialise();
    }

    mute() {
        this.soundChip.mute();
        this.ddNoise.mute();
    }

    unmute() {
        this.soundChip.unmute();
        this.ddNoise.unmute();
    }
}
