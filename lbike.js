"use strict";
var myName;
var pool = null;
var rtcgroup = null;
const model_bike_prom = fetch('light-bike.stl').then(function(r){return r.arrayBuffer()}).then(function(b){return new STL(b)});
var model_bike;
const canv3d = document.getElementById('lbike-canv3d');
const statfield = document.getElementById('lbike-status');
const instructions = document.getElementById('instructions');
const but_start = document.getElementById('lbike-start');
const colorpicker = document.getElementById('colorpicker');
but_start.disabled = true;
const lbike_wall_frag = `#version 300 es
precision highp float;
flat in vec4 o_color;
in vec3 o_screenpos;
out vec4 fragColor;
void main(){
	fragColor = vec4(o_color.xyz * (abs(normalize(fwidth(o_screenpos)).z*0.5+0.5)), 1.0);
}`;
const lbike_vert = `#version 300 es
precision highp float;
uniform mat4 u_view_mat;
in vec3 i_position;
in vec4 i_color;
flat out vec4 o_color;
out vec3 o_screenpos;
void main(){
	gl_Position = u_view_mat * vec4(i_position, 1.0);
	o_screenpos = i_position;
	o_color = i_color;
}`;
const glHints = {
	alpha: true, //Avoid alpha:false, which can be expensive (From MDN best practices)
	stencil: false,
	antialias: false,
	desynchronized: false,
}
const ctx3d = canv3d.getContext('webgl2', glHints);
if(null == ctx3d){
	window.alert('WebGL2 required, but not available.');
}
const lbike_zplanes = new Float32Array([200, 5000000]);
let lbike_cam_lens = new Mat4();
lbike_cam_lens.gluPerspective(1.5, ctx3d.canvas.width/ctx3d.canvas.height, lbike_zplanes[0], lbike_zplanes[1]);//vfov was 1.22
let vbuffer = ctx3d.createBuffer();
let vibuffer = ctx3d.createBuffer();
let bikevbuffer = ctx3d.createBuffer();
ctx3d.viewport(0, 0, ctx3d.canvas.width, ctx3d.canvas.height);//FIXME this line shouldnt be copied anywhere
ctx3d.enable(ctx3d.DEPTH_TEST);
ctx3d.disable(ctx3d.CULL_FACE);
ctx3d.clearColor(0,0.5,0.5,1);
const wallProg = new WGLProg(ctx3d, lbike_vert, lbike_wall_frag, ['u_view_mat'], ['i_position','i_color']);
if(wallProg.inError()) console.warn("wallProg failed to build");
var myColor = '#00ff00';
var cameraMode = 1;
function cycleCamera(setto=0){
	if(setto == 0){
		cameraMode++;
		if(cameraMode > 3){
			cameraMode = 1;
		}
	}else{
		cameraMode = setto;
	}
	console.log("Set Camera Mode:", cameraMode);
}
document.onkeydown = function(evt){if(currentRound) currentRound.keydown(evt);};
canv3d.addEventListener("pointerdown", (event) => {if(currentRound){currentRound.pointerdown(event);}});
document.onkeyup = function(evt){if(currentRound) currentRound.keyup(evt);};
async function joingame(name, room){
	model_bike = await model_bike_prom;
	loadmodel(model_bike, ctx3d, bikevbuffer, 12000);
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
	instructions.style.display = 'none';
	currentRound = new TronRound(ctx3d, params.seed, players, myName, params.aicount);
	updateSetColor();
}
function loadmodel(stl, gl, glbuf, mult){
	let ary = new ArrayBuffer(4*4*3*stl.triangle_count);
	let aryf32 = new Float32Array(ary);
	let aryui32 = new Uint32Array(ary);
	stl.getTriangles().forEach(function(pt, idx){
		aryf32[idx*4] = pt[0]*mult;
		aryf32[idx*4+1] = pt[1]*mult;
		aryf32[idx*4+2] = pt[2]*mult;
		aryui32[idx*4+3] = 0xFFAAAAAA;
	});
	gl.bindBuffer(gl.ARRAY_BUFFER, glbuf);
	gl.bufferData(gl.ARRAY_BUFFER, aryf32, gl.STATIC_DRAW, 0);
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
const cBoostPower = 40000; // Max boost for a one-sided grind
const cDragExp = 2;//3 for a normal fluid
const cRadixShift = 11; //bitshift to group locations in buckets
class TronRound{
	constructor(ctx3d, seed, players, myname, aicount){
		this.startmilli = performance.now();
		this.ctx3d = ctx3d;
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
		this.pushWall(0, [0, 0, 300000, -1]);
		this.pushWall(1, [0, 0, 300000, -1]);
		this.pushWall(0, [300000, 0, 300000, -1]);
		this.pushWall(1, [300000, 0, 300000, -1]);
		this.snapshots = [];
		this.snapshot();
		this.run = true;
		window.requestAnimationFrame(this.drawframe.bind(this));
	}
	pushWall(d, w){
		let idx = this.walls[d].length;
		this.walls[d].push(w);
		let bucket = w[0] >> cRadixShift;
		let rw = this.radixWalls[d];
		while(bucket >= rw.length){
			rw.push([]);
		}
		rw[bucket].push(idx);
		return idx;
	}
	generateRandomStart(bikeidx){
		let sx = this.rand()%200000+50000;
		let sy = this.rand()%200000+50000;
		let d = 0;
		if(sx > 150000) d=2;
		if(sy > 200000) d=1;
		if(sy < 100000) d=3;
		let w1;
		let w2;
		if(d == 0 || d == 2){
			w1 = 0;
			w2 = this.pushWall(0, [sy, sx, sx, bikeidx]);
		}else{
			w1 = 1;
			w2 = this.pushWall(1, [sx, sy, sy, bikeidx]);
		}
		return {sx:sx, sy:sy, w1:w1, d:d, w2:w2};
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
			ai:window.structuredClone(this.ai),
			radixWalls:window.structuredClone(this.radixWalls)
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
		this.radixWalls = window.structuredClone(snap.radixWalls);
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
								wploc.w2 = this.pushWall(iter, [w[0], w[1], w[1], w[3]]);
							}
							w[1] = x+minorOffset;
						}else if(upperendstate == 0){
							// Destroy the upper end
							if(activeEnd == 1){
								// User is in the blast, get them a new line
								wploc.w2 = this.pushWall(iter, [w[0], w[2], w[2], w[3]]);
							}
							w[2] = x-minorOffset;
						}else{
							// Destroy the middle of the line
							if(activeEnd == 1){
								// Move the user's line reference to the new line which is about to get created
								wploc.w2 = this.walls[iter].length;
							}
							this.pushWall(iter, [w[0], x+minorOffset, w[2], w[3]]);
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
		let lowbucketidx;
		let highbucketidx;
		// Extend Walls based on direction
		if(ploc.d == 0){
			lowbucketidx = ploc.x >> cRadixShift;
			ploc.x = currentWall[2] += ploc.s;
			highbucketidx = ploc.x >> cRadixShift;
		}else if(ploc.d == 1){
			highbucketidx = ploc.y >> cRadixShift;
			ploc.y = currentWall[1] -= ploc.s;
			lowbucketidx = ploc.y >> cRadixShift;
		}else if(ploc.d == 2){
			highbucketidx = ploc.x >> cRadixShift;
			ploc.x = currentWall[1] -= ploc.s;
			lowbucketidx = ploc.x >> cRadixShift;
		}else{
			lowbucketidx = ploc.y >> cRadixShift;
			ploc.y = currentWall[2] += ploc.s;
			highbucketidx = ploc.y >> cRadixShift;
		}
		let major1;
		let major2;
		let minor;
		let testlist; // Walls we can collide with
		let bucketlist;
		if(ploc.w1 == 0){
			//Heading Horizontal
			major1 = oldx;
			major2 = ploc.x;
			minor = ploc.y;
			testlist = this.walls[1];
			bucketlist = this.radixWalls[1];
		}else{
			//Heading Vertical
			major1 = oldy;
			major2 = ploc.y;
			minor = ploc.x;
			testlist = this.walls[0];
			bucketlist = this.radixWalls[0];
		}
		lowbucketidx = Math.max(0, lowbucketidx);
		highbucketidx = Math.min(bucketlist.length-1, highbucketidx);
		for(let bucketIdx = lowbucketidx; bucketIdx <= highbucketidx; bucketIdx++){
			let bucket = bucketlist[bucketIdx];
			for(let twallidx = 0; twallidx < bucket.length; twallidx++){
				let w = testlist[bucket[twallidx]];
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
	colorToInt(c, dv, offset){
		if(c[0] == '#') c = c.substring(1);
		if(c.length < 6){
			c = c[0]+'0'+c[1]+'0'+c[2]+'0';
		}else if(c.length > 6){
			c = c.substring(0, 6);
		}
		let v = (parseInt(c, 16)<<8)|0xff;
		dv.setUint32(offset, v);
	}
	draw3d(){
		// determine everyone's color
		let pcolora = new ArrayBuffer(4*(1+this.playerById.length+this.ai.length))
		let pcolor = new Uint32Array(pcolora);
		let pcolord = new DataView(pcolora);
		this.colorToInt('efecb3', pcolord, 0);
		for(let peerId = 0; peerId < this.playerById.length; peerId++){
			//console.log(this.bike[peerId].s);
			this.colorToInt(peers[this.playerById[peerId]].color, pcolord, 4*(1+peerId));
		}
		for(let aiId = 0; aiId < this.ai.length; aiId++){
			this.colorToInt('FF0000', pcolord, 4*(1+this.playerById.length+aiId));
		}
		let ctx3d = this.ctx3d;
		ctx3d.clear(ctx3d.DEPTH_BUFFER_BIT | ctx3d.COLOR_BUFFER_BIT);
		ctx3d.useProgram(wallProg.prog);
		let wallHeight = 2000;
		let wallCount = this.walls[0].length+this.walls[1].length;
		let pointCount = 4*wallCount;//+4;
		let wallArrayBuf = new ArrayBuffer(4*4*pointCount);//three coords and one ui32 (split into colors) per point. 4 bytes per.
		let wallArray = new Float32Array(wallArrayBuf);
		let wallArrayi = new Uint32Array(wallArrayBuf);
		let idxArray = new Uint16Array(6*wallCount);//six indices to make a quad
		let topIdxArray = new Uint16Array(2*wallCount);//two indices to draw the top of a wall in line mode
		for(let wi = 0; wi < this.walls[0].length; wi++){
			let w = this.walls[0][wi];
			let wao = wi*16;
			let wio = wi*6;
			let witlo = wi*2;
			// X coords
			wallArray[wao] = wallArray[wao+4] = w[1];
			wallArray[wao+8] = wallArray[wao+12] = w[2];
			// Y coords
			wallArray[wao+1] = wallArray[wao+5] = wallArray[wao+9] = wallArray[wao+13] = w[0];
			// Z coords
			wallArray[wao+2] = wallArray[wao+10] = wallHeight;
			wallArray[wao+6] = wallArray[wao+14] = 0;
			// Colors
			wallArrayi[wao+3] = wallArrayi[wao+7] = wallArrayi[wao+11] = wallArrayi[wao+15] = pcolor[w[3]+1];
			// Element indices
			idxArray[wio] = wi*4;
			idxArray[wio+5] = idxArray[wio+1] = wi*4+1;
			idxArray[wio+4] = idxArray[wio+2] = wi*4+2;
			idxArray[wio+3] = wi*4+3;
			// Top Line
			topIdxArray[witlo] = wi*4;
			topIdxArray[witlo+1] = wi*4+2;
		}
		for(let wi2 = 0; wi2 < this.walls[1].length; wi2++){
			let w = this.walls[1][wi2];
			let wi = wi2+this.walls[0].length;
			let wao = wi*16;
			let wio = wi*6;
			let witlo = wi*2;
			// X coords
			wallArray[wao+1] = wallArray[wao+5] = w[1];
			wallArray[wao+9] = wallArray[wao+13] = w[2];
			// Y coords
			wallArray[wao] = wallArray[wao+4] = wallArray[wao+8] = wallArray[wao+12] = w[0];
			// Z coords
			wallArray[wao+2] = wallArray[wao+10] = wallHeight;
			wallArray[wao+6] = wallArray[wao+14] = 0;
			// Colors
			wallArrayi[wao+3] = wallArrayi[wao+7] = wallArrayi[wao+11] = wallArrayi[wao+15] = pcolor[w[3]+1];
			// Element indices
			idxArray[wio] = wi*4;
			idxArray[wio+5] = idxArray[wio+1] = wi*4+1;
			idxArray[wio+4] = idxArray[wio+2] = wi*4+2;
			idxArray[wio+3] = wi*4+3;
			// Top Line
			topIdxArray[witlo] = wi*4;
			topIdxArray[witlo+1] = wi*4+2;
		}
		ctx3d.bindBuffer(ctx3d.ARRAY_BUFFER, vbuffer);
		ctx3d.bufferData(ctx3d.ARRAY_BUFFER, wallArray, ctx3d.STREAM_DRAW, 0);
		ctx3d.bindBuffer(ctx3d.ELEMENT_ARRAY_BUFFER, vibuffer);
		ctx3d.bufferData(ctx3d.ELEMENT_ARRAY_BUFFER, idxArray, ctx3d.STREAM_DRAW, 0);
		ctx3d.vertexAttribPointer(wallProg.i['i_position'], 3, ctx3d.FLOAT, false, 16, 0);
		ctx3d.vertexAttribPointer(wallProg.i['i_color'], 4, ctx3d.UNSIGNED_BYTE, true, 16, 12);
		let myloc = this.bike[this.myplayerid];
		let myvec = [[1,0],[0,-1],[-1,0],[0,1]][myloc.d];
		let movemat = new Mat4();
		let rotmat = new Mat4();
		let drawTris = true;
		let drawMyBike = true;
		let drawOtherBikes = true;
		if(cameraMode == 1){
			// Standard fly-behind
			movemat.trans(-myloc.x+myvec[0]*10000, -myloc.y+myvec[1]*10000, -20000);
			let downAngle = Math.PI/4;
			let dASin = Math.sin(downAngle);
			let dACos = Math.cos(downAngle);
			rotmat.glhLookAtf2([myvec[0]*dACos, myvec[1]*dACos, -dASin], [myvec[0]*dASin, myvec[1]*dASin, dACos]);
		}else if(cameraMode == 2){
			// In-cab first-person
			drawMyBike = false;
			movemat.trans(-myloc.x, -myloc.y, -2000);
			rotmat.glhLookAtf2([myvec[0], myvec[1], 0], [0, 0, 1]);
		}else if(cameraMode == 3){
			// Bird's eye top down
			drawMyBike = false;
			drawOtherBikes = false;
			drawTris = false;
			movemat.trans(-150000,-150000,-200000);
			rotmat.glhLookAtf2([0, 0, -1], [0, 1, 0]);
		}else{
			console.warn("unknown camera mode", cameraMode);
		}

		let viewmat = new Mat4();
		viewmat.mult(lbike_cam_lens);
		viewmat.mult(rotmat);
		viewmat.mult(movemat);
		ctx3d.uniformMatrix4fv(wallProg.i['u_view_mat'], false, viewmat.arr);
		if(drawTris){
			ctx3d.drawElements(ctx3d.TRIANGLES, 6*wallCount, ctx3d.UNSIGNED_SHORT, 0);
		}
		ctx3d.bufferData(ctx3d.ELEMENT_ARRAY_BUFFER, topIdxArray, ctx3d.STREAM_DRAW, 0);
		ctx3d.drawElements(ctx3d.LINES, 2*wallCount, ctx3d.UNSIGNED_SHORT, 0);
		if(drawMyBike || drawOtherBikes){
			ctx3d.bindBuffer(ctx3d.ARRAY_BUFFER, bikevbuffer);
			ctx3d.vertexAttribPointer(wallProg.i['i_position'], 3, ctx3d.FLOAT, false, 16, 0);
			ctx3d.vertexAttribPointer(wallProg.i['i_color'], 4, ctx3d.UNSIGNED_BYTE, true, 16, 12);
			ctx3d.drawArrays(ctx3d.TRIANGLES, 0, model_bike.triangle_count*3);
		}
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
		let closestLower = -cBoostDist;
		let closestUpper = cBoostDist;
		let warry = this.walls[bike.w1];
		let bucketlist = this.radixWalls[bike.w1];
		let majorc;
		let minorc;
		if(bike.w1 == 0){
			majorc = bike.y;
			minorc = bike.x;
		}else{
			majorc = bike.x;
			minorc = bike.y;
		}
		let lowbucketidx = Math.max(0, (majorc-cBoostDist)>>cRadixShift);
		let highbucketidx = Math.min(bucketlist.length-1, (majorc+cBoostDist)>>cRadixShift);
		for(let bucketidx = lowbucketidx; bucketidx <= highbucketidx; bucketidx++){
			let bucket = bucketlist[bucketidx];
			for(let wcheckidx = 0; wcheckidx < bucket.length; wcheckidx++){
				let widx = bucket[wcheckidx];
				let w = warry[widx];
				if(w[1] <= minorc && w[2] >= minorc && widx != bike.w2){
					let woffset = majorc-w[0];
					if(woffset < 0){
						if(woffset > closestLower) closestLower = woffset;
					}else{
						if(woffset < closestUpper) closestUpper = woffset;
					}
				}
			}
		}
		return cBoostPower/cBoostDist*((cBoostDist+closestLower) + (cBoostDist-closestUpper));
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
						ploc.w2 = this.pushWall(0, [ploc.y, ploc.x, ploc.x, pidx]);
					}else{
						ploc.w2 = this.pushWall(1, [ploc.x, ploc.y, ploc.y, pidx]);
					}
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
		// console.log('Walls:',(this.walls[0].length+this.walls[1].length));
		//console.log(this.bike[0].x, this.bike[0].y);
		//this.draw();
		this.draw3d();
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
		if(xp < this.ctx3d.canvas.width/2){
			this.sendInput(f, -1);
		}else{
			this.sendInput(f, 1);
		}
	}
	keyup(evt){
	}
	keydown(evt){
		let f = this.getFrame();
		if(evt.keyCode == 37){
			this.sendInput(f, -1);
		}else if(evt.keyCode == 39){
			this.sendInput(f, 1);
		}else if(evt.keyCode >= 49 && evt.keyCode <= 51){
			// Camera set mode 1 through 3.
			cycleCamera(evt.keyCode-48);
		}else if(evt.keyCode == 67){
			// Cycle to next camera mode.
			cycleCamera();
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
