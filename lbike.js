"use strict";
var myName;
var pool = null;
var rtcgroup = null;

const canv = document.getElementById('lbike-canv');
const statfield = document.getElementById('lbike-status');
const but_start = document.getElementById('lbike-start');
const colorpicker = document.getElementById('colorpicker');
but_start.disabled = true;
const ctx = canv.getContext("2d");
ctx.fillRect(0, 0, canv.width, canv.height);
var myColor = '#00ff00';
document.onkeydown = function(evt){if(currentRound) currentRound.keydown(evt);};
canv.addEventListener("pointerdown", (event) => {if(currentRound){currentRound.pointerdown(event);}});
document.onkeyup = function(evt){if(currentRound) currentRound.keyup(evt);};
async function joingame(name, room){
	myName = name.value;
	peers[myName] = {color:myColor};
	if(pool) pool.leavePool();
	if(rtcgroup) rtcgroup.die();
	pool = new PoolSig("net.boerwi.lbike."+room.value, name.value);
	rtcgroup = new PeerRtcGroup(pool);
	rtcgroup.drawStatus = drawRtcStatus;
	rtcgroup.onreceive = onReceive;
	rtcgroup.ongainpeer = onGainPeer;
	rtcgroup.onlosepeer = onLosePeer;
	await pool.joinPool();
	but_start.disabled = false;
}
function updateSetColor(){
	myColor = colorpicker.value;
	peers[myName].color = myColor;
	if(rtcgroup) rtcgroup.broadcast({set:{color:myColor}});
}
function startgame_button(ai_count){
	let startparams = {start:true, seed:Math.floor(Math.random() * 9000000)+1, aicount:ai_count.value};
	rtcgroup.broadcast(startparams);
	startgame(startparams);
}
var currentRound = null;
function startgame(params){
	let players = Object.keys(rtcgroup.peers);
	players.push(myName);
	if(currentRound){
		currentRound.die();
	}
	currentRound = new TronRound(ctx, params.seed, players, myName, params.aicount);
	updateSetColor();
}
// joule = newton*meter
// joule = watt*second
const cPower = 20000;// Watts
const cMass = 10;// Kg
const cDrag = 2.0;// DragForce = cDrag*v^cDragExp
const cTurnEnergyEfficiency = 0.9; // You conserve this amount of kinetic energy during a turn
const cFrameMS = 5; // Milliseconds per frame
const cFrameS = cFrameMS/1000; // Seconds per frame
const cBoostDist = 5000; // Distance within which walls boost you
const cBoostPower = 20000; // Max boost for a one-sided grind
const cDragExp = 2;//3 for a normal fluid
const cRadixBuckets = 256;
class TronRound{
	constructor(ctx, seed, players, myname, aicount){
		this.startmilli = performance.now();
		this.ctx = ctx;
		this.seed = seed;
		this.myname = myname;
		this.playerById = players.sort();
		this.idByPlayer = {};
		for(const pidx in this.playerById){
			this.idByPlayer[this.playerById[pidx]] = pidx;
		}
		this.myplayerid = this.idByPlayer[myname];
		this.playerInputs = [];
		// Things that get snapshots
			this.rstate = seed;
			this.frame = 0;
			// Pattern of major coordinate, low minor coordinate, high minor coordinate, owner
			// First subarray is horizontal walls, second is vertical
			this.walls = [[],[]];
			this.radixWalls = [[],[]];
			// An array of locations, directions, frames, and references to current walls
			this.bike = [];
			// A list of currently active explosions
			this.activeExplosions = [];
			// Which input is next to be evaluated for this player
			this.nextPlayerInputIdx = [];
			this.ai = [];
		//
		for(let pidx = 0; pidx < this.playerById.length; pidx++){
			this.playerInputs.push([]);
			// Start Location
			let sl = this.generateRandomStart(pidx);
			this.bike.push({x:sl.sx, y:sl.sy, d:sl.d, s:0, w1:sl.w1, w2:sl.w2, dead:false, energy:0, maxspeed:0});
			this.playerInputs.push([]);
			this.nextPlayerInputIdx.push(0);
		}
		for(let aiidx = 0; aiidx < aicount; aiidx++){
			let nai = {bike:this.playerById.length+aiidx, thinkTimer:0, thinkDelay:50};
			let sl = this.generateRandomStart(nai.bike);
			this.bike.push({x:sl.sx, y:sl.sy, d:sl.d, s:0, w1:sl.w1, w2:sl.w2, dead:false, energy:0, maxspeed:0});
			this.ai.push(nai);
		}
		this.walls[0].push([0, 0, 300000, -1]);
		this.walls[1].push([0, 0, 300000, -1]);
		this.walls[0].push([300000, 0, 300000, -1]);
		this.walls[1].push([300000, 0, 300000, -1]);
		this.snapshots = [];
		this.snapshot();
		this.run = true;
		window.requestAnimationFrame(this.drawframe.bind(this));
	}
	generateRandomStart(bikeidx){
		let sx = this.rand()%200000+50000;
		let sy = this.rand()%200000+50000;
		let d = 0;
		if(sx > 150000) d=2;
		if(sy > 200000) d=1;
		if(sy < 100000) d=3;
		let w1 = 0;
		if(d == 0 || d == 2){
			w1 = 0;
			this.walls[0].push([sy, sx, sx, bikeidx]);
		}else{
			w1 = 1;
			this.walls[1].push([sx, sy, sy, bikeidx]);
		}
		return {sx:sx, sy:sy, w1:w1, d:d, w2:this.walls[w1].length-1};
	}
	die(){
		this.run = false;
	}
	rand(){
		this.rstate = xorshift32(this.rstate);
		return Math.abs(this.rstate);
	}
	getFrame(){
		return Math.floor((performance.now()-this.startmilli) / cFrameMS);
	}
	snapshot(){
		this.snapshots.push({
			rstate:this.rstate,
			frame:this.frame,
			walls:window.structuredClone(this.walls),
			bike:window.structuredClone(this.bike),
			nextPlayerInputIdx:window.structuredClone(this.nextPlayerInputIdx),
			activeExplosions:window.structuredClone(this.activeExplosions),
			ai:window.structuredClone(this.ai)
		});
		// prune excessive snapshots, but not the initial state
		if(this.snapshots.length > 20){
			this.snapshots.splice(1,1); // Remove the second-oldest snapshot
		}
	}
	applyLatestSnapshot(){
		let snap = this.snapshots[this.snapshots.length-1];
		this.rstate = snap.rstate;
		this.frame = snap.frame;
		this.walls = window.structuredClone(snap.walls);
		this.bike = window.structuredClone(snap.bike);
		this.nextPlayerInputIdx = window.structuredClone(snap.nextPlayerInputIdx);
		this.activeExplosions = window.structuredClone(snap.activeExplosions);
		this.ai = window.structuredClone(snap.ai);
	}
	distance(x, y, d){
		let retlarge = Infinity;
		let retsmall = -Infinity;
		let wl;
		let major;
		let minor;
		if(d == 0 || d == 2){
			// d is horizontal
			wl = this.walls[1];
			major = x;
			minor = y;
		}else{
			// d is vertical
			wl = this.walls[0];
			major = y;
			minor = x;
		}
		for(let widx = 0; widx < wl.length; widx++){
			let w = wl[widx];
			if(w[1] <= minor && w[2] >= minor){
				let delta = w[0]-major;
				if(delta > 0){
					if(delta < retlarge) retlarge = delta;
				}else if(delta < 0){
					if(delta > retsmall) retsmall = delta;
				}
			}
		}
		retsmall = Math.abs(retsmall);
		if(d == 0 || d == 3){
			return [retlarge, retsmall];
		}else{
			return [retsmall, retlarge];
		}
	}
	explode(pidx, x, y){
		console.log(this.playerById[pidx]+" core dumped at ("+x+","+y+")");
		this.bike[pidx].dead = true;
		const radius = 5000;
		const radiussq = Math.pow(radius, 2);
		this.activeExplosions.push([x,y,radius,this.frame+100,pidx]);
		for(let iter = 0; iter < 2; iter++){
			for(let idx = 0; idx < this.walls[iter].length; idx++){
				let w = this.walls[iter][idx];
				if(w[3] != -1 && w[0] > y-radius && w[0] < y+radius){
					// This line is in the correct 'band' to be affected
					// Walls with owner -1 are invincible
					//  iif NOT both sides are outside, on the same side, of the explosion
					let lowerendstate = 0;
					let upperendstate = 0;
					let ydiffsq = Math.pow(w[0]-y, 2);
					// Calculate the positions of the line ends
					if(Math.sqrt(Math.pow(w[1]-x, 2)+ydiffsq) <= radius){
						//lowerendstate = 0;
					}else{
						if(w[1] < x) lowerendstate = -1;
						else lowerendstate = 1;
					}
					if(Math.sqrt(Math.pow(w[2]-x, 2)+ydiffsq) <= radius){
						//upperendstate = 0;
					}else{
						if(w[2] < x) upperendstate = -1;
						else upperendstate = 1;
					}
					// Figure out who, if anyone, uses this line currently
					let wploc = null;
					// If someone is using this wall, this is if they are using the lower (0) end, or the upper (1) end.
					let activeEnd = -1;
					for(let twallp = 0; twallp < this.bike.length; twallp++){
						if(this.bike[twallp].dead == false && this.bike[twallp].w1 == iter && this.bike[twallp].w2 == idx){
							// This player uses this wall...
							wploc = this.bike[twallp];
							if(wploc.d == 0 || wploc.d == 3){
								activeEnd = 1;
							}else{
								activeEnd = 0;
							}
							break;
						}
					}
					// Figure out a verdict based on upperendstate and lowerendstate
					if(lowerendstate == upperendstate){
						if(lowerendstate == 0){
							// Destroy the whole line
							if(wploc == null){
								w[0] = Infinity;
								w[1] = Infinity;
								w[2] = Infinity;
							}else{
								// Make the line continue where the wall's user is (but zero length, since it should have been destroyed)
								if(activeEnd == 0){
									w[2] = w[1];
								}else{
									w[1] = w[2];
								}
							}
						}else{/* Nothing gets destroyed */}
					}else{
						let minorOffset = Math.sqrt(radiussq - ydiffsq);
						if(lowerendstate == 0){
							// Destroy the lower end
							if(activeEnd == 0){
								// User is in the blast, get them a new line
								wploc.w2 = this.walls[iter].length;
								this.walls[iter].push([w[0], w[1], w[1], w[3]]);
							}
							w[1] = x+minorOffset;
						}else if(upperendstate == 0){
							// Destroy the upper end
							if(activeEnd == 1){
								// User is in the blast, get them a new line
								wploc.w2 = this.walls[iter].length;
								this.walls[iter].push([w[0], w[2], w[2], w[3]]);
							}
							w[2] = x-minorOffset;
						}else{
							// Destroy the middle of the line
							if(activeEnd == 1){
								// Move the user's line reference to the new line which is about to get created
								wploc.w2 = this.walls[iter].length;
							}
							this.walls[iter].push([w[0], x+minorOffset, w[2], w[3]]);
							w[2] = x-minorOffset;
						}
					}
				}
			}
			// Flip x and y, then reevaluate for the vertical lines
			let t = x;
			x = y;
			y = t;
		}
	}
	moveBike(pidx){
		let ploc = this.bike[pidx];
		let oldx = ploc.x;
		let oldy = ploc.y;
		// Move the user, extending their current wall
		let currentWall = this.walls[ploc.w1][ploc.w2];
		// Extend Walls based on direction
		if(ploc.d == 0){
			ploc.x = currentWall[2] += ploc.s;
		}else if(ploc.d == 1){
			ploc.y = currentWall[1] -= ploc.s;
		}else if(ploc.d == 2){
			ploc.x = currentWall[1] -= ploc.s;
		}else{
			ploc.y = currentWall[2] += ploc.s;
		}
		let major1;
		let major2;
		let minor;
		let testlist; // Walls we can collide with
		if(ploc.w1 == 0){
			//Heading Horizontal
			major1 = oldx;
			major2 = ploc.x;
			minor = ploc.y;
			testlist = this.walls[1];
		}else{
			//Heading Vertical
			major1 = oldy;
			major2 = ploc.y;
			minor = ploc.x;
			testlist = this.walls[0];
		}
		for(let twallidx = 0; twallidx < testlist.length; twallidx++){
			let w = testlist[twallidx];
			if(
				((major1 < w[0] && major2 >= w[0]) || (major1 > w[0] && major2 <= w[0])) &&
				(w[1] <= minor && w[2] >= minor)
			){
				// We have crossed this wall. Prepare to die.
				if(ploc.w1 == 0){
					this.explode(pidx, w[0], minor);
				}else{
					this.explode(pidx, minor, w[0]);
				}
			}
		}
	}
	runAi(aiidx, bike){
		let ai = this.ai[aiidx];
		let turn = 0;
		if(ai.thinkTimer > 0){
			ai.thinkTimer -= 1;
		}else{
			ai.thinkTimer = ai.thinkDelay;
			let frontd = this.distance(bike.x, bike.y, bike.d)[0];
			let sided = this.distance(bike.x, bike.y, (bike.d+1)%4);
			if(sided[0] > sided[1]){
				if(sided[0] > frontd){
					turn = 1;
				}
			}else{
				if(sided[1] > frontd){
					turn = -1;
				}
			}
			/*if(this.rand() % 500 < 25){
				turn = 1;
			}*/
		}
		return turn;
	}
	draw(){
		let ctx = this.ctx;
		ctx.fillStyle="#000000";
		ctx.strokeStyle="#00FF00";
		// determine everyone's color
		let pcolor = [];
		for(let peerId = 0; peerId < this.playerById.length; peerId++){
			//console.log(this.bike[peerId].s);
			pcolor.push(peers[this.playerById[peerId]].color);
		}
		for(let aiId = 0; aiId < this.ai.length; aiId++){
			pcolor.push("#FF0000");
		}
		// Adjust view matrix
		ctx.resetTransform();
		ctx.fillRect(0, 0, canv.width, canv.height);
		let myloc = this.bike[this.myplayerid];
		//adjust player to corner
		ctx.transform(1,0,0,1, ctx.canvas.width/2, ctx.canvas.height*0.9);
		ctx.scale(0.002, 0.002);
		ctx.rotate(Math.PI/2*(myloc.d-1));
		ctx.transform(1,0,0,1,-myloc.x, -myloc.y);
		ctx.lineWidth = 1000;
		ctx.lineCap = 'square';
		// draw every wall
		for(let widx = 0; widx < this.walls[0].length; widx++){
			// Draw Horizontal
			let w = this.walls[0][widx];
			if(w[3] == -1) ctx.strokeStyle='#efecb3';
			else ctx.strokeStyle=pcolor[w[3]];
			ctx.beginPath();
			ctx.moveTo(w[1], w[0]);
			ctx.lineTo(w[2], w[0]);
			ctx.stroke();
		}
		for(let widx = 0; widx < this.walls[1].length; widx++){
			// Draw Vertical
			let w = this.walls[1][widx];
			if(w[3] == -1) ctx.strokeStyle='#efecb3';
			else ctx.strokeStyle=pcolor[w[3]];
			ctx.beginPath();
			ctx.moveTo(w[0], w[1]);
			ctx.lineTo(w[0], w[2]);
			ctx.stroke();
		}
		// Draw Explosions
		for(let exidx = 0; exidx < this.activeExplosions.length; exidx++){
			let explosion = this.activeExplosions[exidx];
			ctx.strokeStyle=pcolor[explosion[4]];
			ctx.beginPath();
			ctx.arc(explosion[0], explosion[1], explosion[2]*(explosion[3]-this.frame)/100, 0, 2 * Math.PI);
			ctx.stroke();
		}
		//performance.mark("draw end");
		//performance.measure("draw", "compute end", "draw end");
	}
	getBoostPower(bike){
		let closestLower = cBoostDist;
		let closestUpper = cBoostDist;
		let warry = this.walls[bike.w1];
		let majorc;
		let minorc;
		if(bike.w1 == 0){
			majorc = bike.y;
			minorc = bike.x;
		}else{
			majorc = bike.x;
			minorc = bike.y;
		}
		for(let wcheckidx = 0; wcheckidx < warry.length; wcheckidx++){
			if(warry[wcheckidx][1] <= minorc && warry[wcheckidx][2] >= minorc && wcheckidx != bike.w2){
				let woffset = majorc-warry[wcheckidx][0];
				if(woffset < 0){
					if(-woffset < closestLower) closestLower = -woffset;
				}else{
					if(woffset < closestUpper) closestUpper = woffset;
				}
			}
		}
		return cBoostPower/cBoostDist*((cBoostDist-closestLower) + (cBoostDist-closestUpper));
	}
	drawframe(){
		let tframe = this.getFrame();
		// simulate everything after the snapshot
		performance.mark('cstart');
		this.applyLatestSnapshot();
		//determine if we need to capture a snapshot this round, and if so, when
		let captureFrame = -1;
		if(tframe - this.frame > 100){ //100f is 500ms
			captureFrame = tframe-50; //plan to capture a frame 250ms ago
		}
		while(this.frame < tframe){
			if(captureFrame == this.frame){
				this.snapshot();
			}
			for(let pidx = 0; pidx < this.bike.length; pidx++){
				let ploc = this.bike[pidx];
				if(ploc.dead == true) continue;
				let turn = 0;
				// Handle User stuff, if a user
				if(pidx < this.playerById.length){
					let pinput = this.playerInputs[pidx];
					// Handle turning the user if they have an input this frame
					for(;this.nextPlayerInputIdx[pidx] < pinput.length; this.nextPlayerInputIdx[pidx] += 1){
						let nextInput = pinput[this.nextPlayerInputIdx[pidx]];
						if(nextInput.frame > this.frame) break;
						if(nextInput.frame == this.frame){
							turn = nextInput.input;
						}
					}
				}else{
					// Handle AI Stuff, if an AI
					let aiidx = pidx - this.playerById.length;
					turn = this.runAi(aiidx, ploc);
				}
				if(turn != 0){
					ploc.energy *= cTurnEnergyEfficiency;
					let oldDir = ploc.d;
					let newDir = (oldDir+4+turn)%4;
					ploc.d = newDir;
					//let oldWall = this.walls[ploc.w1][ploc.w2];
					ploc.w1 ^= 1; //alternate horizontal and vertical
					if(ploc.w1 == 0){
						this.walls[0].push([ploc.y, ploc.x, ploc.x, pidx]);
					}else{
						this.walls[1].push([ploc.x, ploc.y, ploc.y, pidx]);
					}
					ploc.w2 = this.walls[ploc.w1].length-1;
				}
				// Drag multiplier based on walls
				let boostPower = this.getBoostPower(ploc);

				// Modify the user's speed
				let netPower = cPower+boostPower-Math.pow(ploc.s, cDragExp)*cDrag;
				ploc.energy += netPower*cFrameS;
				ploc.s = Math.sqrt(2*ploc.energy/cMass);
				if(ploc.s > ploc.maxspeed) ploc.maxspeed = ploc.s;
				this.moveBike(pidx);
			}
			this.frame += 1;
		}
		while(this.activeExplosions.length > 0 && this.activeExplosions[0][3] <= tframe){
			this.activeExplosions.shift();
		}
		performance.mark('cend');
		performance.measure('compute', 'cstart', 'cend');
		this.draw();

		if(this.run) window.requestAnimationFrame(this.drawframe.bind(this));
	}
	async sendInput(frame, i){
		this.applyInput(this.myname, frame, i);
		//var peerdelay = 2000;
		//await new Promise(r => setTimeout(r, peerdelay));
		rtcgroup.broadcast({"input":{"name":this.myname, "frame":frame, "i":i}});
	}
	applyInput(name, frame, input){
		let playerid = this.idByPlayer[name];
		let pinputs = this.playerInputs[playerid];
		// Insert the input in the appropriate location
		let loc = pinputs.length;
		while(loc != 0){
			if(pinputs[loc-1].frame > frame){
				// This one happened after what we are currently recording
				loc -= 1;
			}else break;
		}
		pinputs.splice(loc, 0, {frame:frame, input:input});
		// Wipe out all invalidated snapshots
		let snpidx = this.snapshots.length-1;
		while(snpidx > 0){
			if(this.snapshots[snpidx].frame >= frame){
				this.snapshots.pop();
				snpidx -= 1;
			}else break;
		}
	}
	pointerdown(evt){
		let f = this.getFrame();
		let xp = evt.offsetX;
		if(xp < this.ctx.canvas.width/2){
			this.sendInput(f, 1);
		}else{
			this.sendInput(f, -1);
		}
	}
	keyup(evt){
	}
	keydown(evt){
		let f = this.getFrame();
		if(evt.keyCode == 37){
			this.sendInput(f, 1);
		}else if(evt.keyCode == 39){
			this.sendInput(f, -1);
		}
	}
}
var gameparams = {};

var peers = {};
function onGainPeer(who){
	peers[who] = {color:"#00ff00"};
}
function onLosePeer(who){
	delete peers[who];
}
function onReceive(from, msg){
	if(msg.set){
		// Update with all of the new properties 
		Object.assign(peers[from], msg.set);
	}
	if(msg.start){
		startgame(msg);
	}
	if(msg.input){
		if(currentRound){
			currentRound.applyInput(msg.input.name, msg.input.frame, msg.input.i);
		}
	}
}
function drawRtcStatus(stat){
	let text = "";
	stat.forEach((e) => {
		text += e.name+'('+e.peers+')'+':'+e.dcstatus+'\n';
	});
	statfield.value = text;
}

function xorshift32(x){
	/* Algorithm "xor" from p. 4 of Marsaglia, "Xorshift RNGs" */
	x ^= x << 13;
	x ^= x >> 17;
	x ^= x << 5;
	return x;
}
