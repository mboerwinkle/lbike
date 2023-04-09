const PI1_2 = Math.PI/2.0;
function isPowerOfTwo(x) {//from khronos group
	return (x & (x - 1)) == 0;
}

function nextHighestPowerOfTwo(x) {//from khronos group
	--x;
	for (var i = 1; i < 32; i <<= 1) {
		x = x | x >> i;
	}
	return x + 1;
}
function cross(res, a, b){
	res[0]=a[1]*b[2]-a[2]*b[1];
	res[1]=a[2]*b[0]-a[0]*b[2];
	res[2]=a[0]*b[1]-a[1]*b[0];
}
function rotate(v, r){
	var s = Math.sin(r);
	var c = Math.cos(r);
	return [v[0]*c - v[1]*s, v[0]*s + v[1]*c];
}
function dot(a, b){
	var res = 0;
	for(var idx = a.length-1; idx >= 0; idx--){
		res += a[idx]*b[idx];
	}
	return res;
}
function scale(v, s){
	return v.map(i => i*s);
}
function norm(v){
	let len = Math.hypot.apply(null, v);
	if(len == 0.0){
		return v;//Everything was zeros
	}
	len = 1/len;
	return v.map(i => i * len);
}
function distance2(x1, y1, x2, y2){
	return Math.hypot(x1-x2, y1-y2);
}

class Mat4{
	constructor(arr=null){
		if(arr){
			this.arr = arr;
		}else{
			this.arr = [];
			this.setTo(Mat4.idenMat); //default to identity matrix
		}
	}
	setTo(other){
		for(var i = 0; i < 16; i++){
			this.arr[i] = other.arr[i];
		}
	}
	// Multiplies a matrix by a 4x1 vector, and saves the result in the vector
	multVec(vec){
		const res = Mat4.tempVec;
		var m1 = this.arr;
		for(var y = 0; y < 4; y++){
			var v = 0.0;
			for(var i = 0; i < 4; i++){
				v += m1[y+4*i] * vec[i];
			}
			res[y] = v;
		}
		for(var i = 0; i < 4; i++){
			vec[i] = res[i];
		}
	}
	mult3Vec(vec){
		const res = Mat4.tempVec;
		var m1 = this.arr;
		for(var y = 0; y < 4; y++){
			var v = 0.0;
			for(var i = 0; i < 3; i++){
				v += m1[y+4*i] * vec[i];
			}
			res[y] = v;
		}
		for(var i = 0; i < 3; i++){
			vec[i] = res[i];
		}
	}
	// Multiplies a matrix by another, and saves the result in _this_
	mult2(mat1, mat2){
		var res = this.arr;
		var m1 = mat1.arr;
		var m2 = mat2.arr;
		for(var x = 0; x < 4; x++){
			for(var y = 0; y < 4; y++){
				var v = 0.0;
				for(var i = 0; i < 4; i++){
					v += m1[y+4*i]*m2[i+4*x];
				}
				res[y+4*x] = v;
			}
		}
	}
	// Multiplies _this_ by another matrix, and save the result in _this_
	mult(other){
		for(var x = 0; x < 4; x++){
			for(var y = 0; y < 4; y++){
				var v = 0;
				for(var i = 0; i < 4; i++){
					v += this.arr[y+4*i]*other.arr[i+4*x];
				}
				Mat4.tempMat.arr[y+4*x] = v;
			}
		}
		this.setTo(Mat4.tempMat);
	}
	trans(x, y, z){
		var r = this.arr;
		r[12] += x;
		r[13] += y;
		r[14] += z;
	}
	//https://www.khronos.org/registry/OpenGL-Refpages/gl2.1/xhtml/gluPerspective.xml
	gluPerspective(fovy, aspect, zNear, zFar){
		var f = 1.0/Math.tan(fovy/2.0);
		var m = this.arr;
		m[0] = f/aspect;
		m[1] = 0;m[2] = 0;m[3] = 0;m[4] = 0;
		m[5] = f;
		m[6] = 0;m[7] = 0;m[8] = 0;m[9] = 0;
		m[10] = (zFar+zNear)/(zNear-zFar);
		m[11] = -1;
		m[12] = 0;m[13] = 0;
		m[14] = (2.0*zFar*zNear)/(zNear-zFar);
		m[15] = 0;
	}
	//modified from https://www.khronos.org/registry/OpenGL-Refpages/gl2.1/xhtml/gluLookAt.xml
	glhLookAtf2(center3D, upVector3D){
		var side = [0,0,0];
		var up = [0,0,0];
		// --------------------
		// Side = forward x up
		cross(side, center3D, upVector3D);
		norm(side);
		// Recompute up as: up = side x forward
		cross(up, side, center3D);
		// --------------------
		this.arr[0] = side[0];
		this.arr[4] = side[1];
		this.arr[8] = side[2];
		// --------------------
		this.arr[1] = up[0];
		this.arr[5] = up[1];
		this.arr[9] = up[2];
		// --------------------
		this.arr[2] = -center3D[0];
		this.arr[6] = -center3D[1];
		this.arr[10] = -center3D[2];
		// --------------------
		this.arr[3] = this.arr[7] = this.arr[11] = this.arr[12] = this.arr[13] = this.arr[14] = 0.0;
		this.arr[15] = 1.0;
	}
	// From gluInvertMatrix
	invert(){
		var inv = Mat4.tempMat;
		var m = this.arr;
		var det;
		inv[0] = m[5]  * m[10] * m[15] - m[5]  * m[11] * m[14] - m[9]  * m[6]  * m[15] + m[9]  * m[7]  * m[14] +m[13] * m[6]  * m[11] - m[13] * m[7]  * m[10];
		inv[4] = -m[4]  * m[10] * m[15] + m[4]  * m[11] * m[14] + m[8]  * m[6]  * m[15] - m[8]  * m[7]  * m[14] - m[12] * m[6]  * m[11] + m[12] * m[7]  * m[10];
		inv[8] = m[4]  * m[9] * m[15] - m[4]  * m[11] * m[13] - m[8]  * m[5] * m[15] + m[8]  * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
		inv[12] = -m[4]  * m[9] * m[14] + m[4]  * m[10] * m[13] +m[8]  * m[5] * m[14] - m[8]  * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
		inv[1] = -m[1]  * m[10] * m[15] + m[1]  * m[11] * m[14] + m[9]  * m[2] * m[15] - m[9]  * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
		inv[5] = m[0]  * m[10] * m[15] - m[0]  * m[11] * m[14] - m[8]  * m[2] * m[15] + m[8]  * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
		inv[9] = -m[0]  * m[9] * m[15] + m[0]  * m[11] * m[13] + m[8]  * m[1] * m[15] - m[8]  * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
		inv[13] = m[0]  * m[9] * m[14] - m[0]  * m[10] * m[13] - m[8]  * m[1] * m[14] + m[8]  * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
		inv[2] = m[1]  * m[6] * m[15] - m[1]  * m[7] * m[14] - m[5]  * m[2] * m[15] + m[5]  * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
		inv[6] = -m[0]  * m[6] * m[15] + m[0]  * m[7] * m[14] + m[4]  * m[2] * m[15] - m[4]  * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
		inv[10] = m[0]  * m[5] * m[15] - m[0]  * m[7] * m[13] - m[4]  * m[1] * m[15] + m[4]  * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
		inv[14] = -m[0]  * m[5] * m[14] + m[0]  * m[6] * m[13] + m[4]  * m[1] * m[14] - m[4]  * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
		inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
		inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
		inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
		inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
		det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
		if (det == 0)
			return false;
		det = 1.0 / det;
		for(var i = 0; i < 16; i++)
			m[i] = inv[i] * det;
		return true;
	}
	static zRot(r){
		var s = Math.sin(r);
		var c = Math.cos(r);
		Mat4.zRotMat.arr[0] = c;
		Mat4.zRotMat.arr[1] = s;
		Mat4.zRotMat.arr[4] = -s;
		Mat4.zRotMat.arr[5] = c;
		return Mat4.zRotMat;
	}
	static translate(x, y, z){
		Mat4.transMat.arr[12] = x;
		Mat4.transMat.arr[13] = y;
		Mat4.transMat.arr[14] = z;
		return Mat4.transMat;
	}
}
Mat4.idenMat = new Mat4([1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]);
Mat4.tempMat = new Mat4();
Mat4.tempVec = [0.0, 0.0, 0.0, 0.0];
Mat4.zRotMat = new Mat4();
Mat4.transMat = new Mat4();

Mat4.lookatMat2 = new Mat4();
Mat4.lookatResultMat = new Mat4();

class Mat3{
	constructor(arr=null){
		if(arr){
			this.arr = arr;
		}else{
			this.arr = [];
			this.setTo(Mat3.idenMat); //default to identity matrix
		}
	}
	setTo(other){
		for(var i = 0; i < 9; i++){
			this.arr[i] = other.arr[i];
		}
	}
	mult2(mat1, mat2){
		var res = this.arr;
		var m1 = mat1.arr;
		var m2 = mat2.arr;
		for(var x = 0; x < 3; x++){
			for(var y = 0; y < 3; y++){
				var v = 0.0;
				for(var i = 0; i < 3; i++){
					v += m1[y+3*i]*m2[i+3*x];
				}
				res[y+3*x] = v;
			}
		}
	}
	mult(other){
		for(var x = 0; x < 3; x++){
			for(var y = 0; y < 3; y++){
				var v = 0;
				for(var i = 0; i < 3; i++){
					v += this.arr[y+3*i]*other.arr[i+3*x];
				}
				Mat4.tempMat.arr[y+3*x] = v;
			}
		}
		this.setTo(Mat3.tempMat);
	}
	trans(x, y){
		var r = this.arr;
		r[6] += x;
		r[7] += y;
	}
	multvec(x, y){
		var v = [x,y,1];
		var r = [0,0];
		var m = this.arr;
		for(var x = 0; x < 2; x++){//Only 2 because we don't care about the last thing.
			var val = 0;
			for(var y = 0; y < 3; y++){
				val += m[x+3*y]*v[y];
			}
			r[x] = val;
		}
		return r;
	}
	static rot(r){
		var s = Math.sin(r);
		var c = Math.cos(r);
		Mat3.rotMat.arr[0] = c;
		Mat3.rotMat.arr[1] = s;
		Mat3.rotMat.arr[3] = -s;
		Mat3.rotMat.arr[4] = c;
		return Mat3.rotMat;
	}
	static translate(x, y){
		Mat3.transMat.arr[6] = x;
		Mat3.transMat.arr[7] = y;
		return Mat3.transMat;
	}
}
Mat3.idenMat = new Mat3([1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]);
Mat3.tempMat = new Mat3();
Mat3.rotMat = new Mat3();
Mat3.transMat = new Mat3();

class WGLProg{
	constructor(gl, vertex, fragment, uniformNames, attrNames){
		this.gl = gl;
		let ver = gl.createShader(gl.VERTEX_SHADER);
		this.ver = ver;
		let frag = gl.createShader(gl.FRAGMENT_SHADER);
		this.frag = frag;
		gl.shaderSource(ver, vertex);
		gl.shaderSource(frag, fragment);
		gl.compileShader(ver);
		gl.compileShader(frag);
		let prog = gl.createProgram();
		this.prog = prog;
		gl.attachShader(prog, ver);
		gl.attachShader(prog, frag);
		gl.linkProgram(prog);
		gl.useProgram(prog);
		this.i = {};
		for(const u of uniformNames){
			this.i[u] = gl.getUniformLocation(prog, u);
		}
		for(const a of attrNames){
			this.i[a] = gl.getAttribLocation(prog, a);
			gl.enableVertexAttribArray(this.i[a]);
		}
	}
	inError(){
		const gl = this.gl;
		return !(gl.getShaderParameter(this.ver, gl.COMPILE_STATUS) && gl.getShaderParameter(this.frag, gl.COMPILE_STATUS) && gl.getProgramParameter(this.prog, gl.LINK_STATUS));
	}
	getInfoLog(){
		const gl = this.gl;
		return 'Vert:"'+gl.getShaderInfoLog(this.ver)+'",Frag:"'+gl.getShaderInfoLog(this.frag)+'",Program:"'+gl.getProgramInfoLog(this.prog)+'"';
	}
}
