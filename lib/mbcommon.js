/*
Copyright 2014 Vytroncs.com and Charles Weissman

This file is part of Vytronics Modbus.Simple driver suite intended to be used with the
vytronics.hmi SCADA software.

Vytronics Modbus.Simple is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Vytronics Modbus.Simple is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with Vytronics HMI.  If not, see <http://www.gnu.org/licenses/>.
*/

//suppress unecessary jslint warnings
/*jslint node: true */

//Modbus common definitions and utilities
'use strict';

module.exports.version = '0.0.0';

//Constant Enum
module.exports.QUALITY = {
    GOOD: 1,
    BAD: 0
};

//Constant default timeout
module.exports.DEFAULT_TIMEOUT = 2000; //ms

//For global logging infrastructure.
var log = require('log4js').getLogger();
module.exports.log = log;

//Default logging level is set to WARN or let it be changed by
//env var MB_ASYNC_LOG_LEVEL at startup
log.setLevel(process.env.MB_ASYNC_LOG_LEVEL || 'WARN');


//Set default logging to warning level
module.exports.log.setLevel('WARN');

//Test if undefined
module.exports.isUndefined = function (obj){
    return typeof obj === 'undefined';
}
//Test if defined
module.exports.isDefined = function (obj){
    return typeof obj !== 'undefined';
}

//Local function to convert array of bytes to proper format for selected mode
function build_message (mode, bytes){
    if ('ascii' === mode){
        return convertBytesToASCII(bytes);
    }
    //TODO - other modes
}
    
    
    

//Calculate longitudal redundancy check of bytes array
//The array only contains the message payload
module.exports.calc_lrc = function(bytes) {
	var lrc = bytes.reduce(function(previousValue, currentValue){
	  return (previousValue + currentValue) & 0xFF;
	});
	lrc = ~lrc & 0x00FF; //8 bit 1's complement
	//console.log("bytes:",bytes);
	return (lrc+1)&0x00FF; // return twos complement 	
};


//Append a checksum onto bytes data
var append_checksum = function (mode, bytes) {
    if (mode === 'ascii'){
        var lrc = module.exports.calc_lrc(bytes);
        bytes.push(lrc);
    }
    //TODO rtu and tcp
};


//Utility function to split a modbus itemname into blockname and indexer. Format is 'block_name@indexer'
module.exports.split_itemname = function(itemname) {
    
    var match;
    
    //Using g so we get index for next search, otherwwise regex.lastIndex would always be 0.
    var regex = /^(.*)@/g;
    
    var blockname = undefined;
    var indexer = undefined;
    if ( match = regex.exec(itemname) ) {
        blockname = match[1];
        indexer = itemname.substr(regex.lastIndex);
    }
    return { blockname: blockname, indexer: indexer };
};


//Local private function
//Convert an RTU ASCII string into bytes array
//Preconditions- asciiStr:
//	is data from serialport readline with CRLF already removed.
//
var convertASCIItoBytes = function(asciiStr) {
	var idx=1; //ignore start of message ":"
	var byteNum=0;
	var bytes = [];
	while (idx < (asciiStr.length-1)) {//pass through message buffer
		//Each hex data is 2 ASCII HEX (base16) chars. Reduce to bytes array with half the values
		bytes[byteNum++]=parseInt(asciiStr.substr(idx,2),16);
		idx+=2;
	}
	return bytes;
};

//Convert an RTU byte array to ASCII char array
//Precondition - bytes is well formed. No value greater than 255 and it represents valid modbus
var convertBytesToASCII = function(bytes) {
    
    var msg = [':'];
    
    //Convert each byte to a 2 char hex string. None of the bytes should be greater than 256.
    bytes.forEach( function (byte){
        var ascii = byte.toString(16).toUpperCase();
        if (ascii.length===1) ascii = '0' + ascii;
        msg.push(ascii);
    });
    
    //Return string of bytes plus CRLF.
	return msg.join('') + "\r\n";
};

//Build a read holding regs reply reply
module.exports.build_0x03_reply = function (mode, addr, start, num_reg, data){

    var bytes=[];
    
    bytes[0] = addr;
    bytes[1] = 0x03; //modbus function code
    bytes[2] = num_reg*2;
    
    //Append data bytes
    for (var i=0; i<num_reg; i++){
        
        //Silently assume zero if undefined? Will be undefined if a slave driver
        //has not registered the word being asked for.
        var value = data[start+i];
        if ( module.exports.isUndefined(value) ) {
            //TODO - log?
            value = 0;
        }
        
        append_word(bytes, value);
    }
    
    //Add checksum and create msg bytes
    append_checksum(mode, bytes);
    var msg = build_message(mode, bytes);
    return msg;
};
  
//Build a write holding regs reply
module.exports.build_0x06_reply = function (mode, addr, index, data){

    var bytes=[];
    
    bytes[0] = addr;
    bytes[1] = 0x06; //modbus function code

    //Add index and value
    append_word(bytes, index);
    append_word(bytes, data);
    
    //Add checksum and create msg bytes
    append_checksum(mode, bytes);
    var msg = build_message(mode, bytes);
    return msg;
};
    
//Preprocess ASCII buffer
//Preprocess a modbus ASCII frame as a string. Checks message format and CRC.
//Returns an object {bytes: <array of byte data>, err:<string>}
//  err is undefined if success. Otherwise contains a string telling what went wrong
//
module.exports.preprocessASCII = function(data) {
	
	//TODO add debug level to turn on and off console logs?

	var idx=0;
    var result = { bytes:[], err:undefined };
	
	//Validate data
	//Minimum message size
	if(data.length < 9) {
		result.err = "Error:read data len=" + data.len + " too short.";
		return result;
	}
	
	//Data length must be odd
	if(0==data.length%2) {
		result.err = "Error:read data len=" + data.len + " must have odd number of bytes";
		return result;
	}
	
	//Must start with ":" and end with CRLF
	if(data.charAt(0) != ":") {
		result.err = "Error:read data must begin with :";
		return result;
	}
		
	//Convert to array of bytes
	var bytes = convertASCIItoBytes(data);
	
	//LRC in transmitted with msg
	//var msg_lrc = (bytes[bytes.length-1]) | ((bytes[bytes.length-2])<<4);
	var msg_lrc = (bytes[bytes.length-1]);
    
	//Calc LRC of bytes excluding payload LRC
	var lrc = module.exports.calc_lrc(bytes.slice(0,-1));
	
	//Must be equal
	if ( lrc!=msg_lrc) {
		result.err = this.port.path + " error bad CRC msg:" +
            msg_lrc + "calc:" + lrc + ' bytes:' + bytes.join(' ');        
		return result;
	}
    
    result.bytes = bytes
	
	return result;
};

//For getting 2 byte words out of an array in modbus endian style
//pre-condition arrray is integer and has enough length
var extract_word = function (bytes, index){
    return (bytes[index]<<8) + bytes[index+1];
};
module.exports.extract_word = extract_word;

//For appending 2 byte word onto an array in modbus endian style
//pre-condition value is 0-255
//Returns the next byte index after insert
var append_word = function (bytes, value){
    bytes.push( (value & 0xFF00) >> 8);
    bytes.push(value & 0x00FF);
};
module.exports.append_word = append_word;

