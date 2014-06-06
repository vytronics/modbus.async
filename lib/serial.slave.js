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

/*
serial.slave.js

Serial RTU and ASCII slave driver. This is a very simple driver. It implements a slave
with n contiguous registers. Items read and write into these registers. Some master in turn reads
the registers to get our controls and writes to the registers to set indications. Only
holding register commands are supported.

*/
"use strict";

//Dependencies
var events = require("events");
var serialport = require("serialport");
var mbcommon = require("./mbcommon");

/*Modbus simple serial slave class.
config = {
    type: 'slave',
    mode: 'ASCII',
    num_regs: 10,
    address: 1,
    timeout: 2000   //Timeout between polls in ms for declaring master online if not undefined.
    serial_port: {
        port_name: 'COM3',
        port_options: {
            baudrate: 9600
            }
    }
}

Constructor is passed the serial slave config object like shown above.
*/

module.exports.create = function (config){
    //TODO - totally ring out and validate slave_config obj
    return new MbSimpleSerialSlave(config);
};

function MbSimpleSerialSlave (config){
    
    var self = this;
    
    //TODO - validate config way more
    if ( ! config ) {
        return undefined;
    }
    
    if (config.type !== 'slave'){
        throw new Error('serial slave - config.type must be slave.');
        //This is a programmer error
        return undefined;
    }
    
    //This driver can emit events
    //emit("itemvalue", item, value);
    self.emitter = new events.EventEmitter();
        
    //Registered items. Each item is an object
    //with mask, get_value and set_value methods
    //See register method for details
    self.items = {};
    
    //Slave config
    self.address = config.address;
    self.num_regs = config.num_regs;
    self.timeout = config.timeout;
    self.timeout_timer = undefined;
    
    //Create holding registers buffer
    //Init to all zero. TODO - leave undefined or add quality code?
    self.registers = new Array(self.num_regs);
    for(var i=0; i<self.registers.length; i++) {
        self.registers[i]=0;
    }
   
    //Serial port config
    if (config.serial_port) {
        var port_config = config.serial_port;

        try {
            var port = new serialport.SerialPort(port_config.port_name,
                                                port_config.port_options,
                                                false); //open immediately flag set to false

            //Tell serialport to use ascii readline parser with CRLF as the end of message
            //delimeter
            port.options.parser=serialport.parsers.readline("\r\n");

            self.port = port;
        } catch (err){
            console.log('error creating port:' + err);
            return undefined;
        }
    }
    else {
        console.log('serial.slave must have config.serial_port.');
        return undefined;
    }
    //Define supported modbus slave function codes and which function for processing
    //
    this.MODBUS_FUNCTIONS = {
        0x03:	slaveReadMyHoldingRegisters,
        0x06:	slaveWriteToOneOfMyRegisters,
        0x10:	slaveWriteToMultipleOfMyRegisters
    };  
}
    
//Private function to set a register and then emit out any itemchanged for
//registered items
//Calling signature set_register.call(driverobj, addr, value)
//
function set_register (word, value){
    if (value !== this.registers[word]){
        
        var change_mask = value ^ this.registers[word];
        
        if ( 0 === change_mask ) return; //nothing has changed
        
        this.registers[word] = value;
              
        //Find any register items that have changed
        Object.getOwnPropertyNames(this.items).forEach(function (item){
            var itemobj = this.items[item];
            
            if ( (itemobj.word === word) && (change_mask & itemobj.mask) ) {
                this.emitter.emit("itemvalue", item, itemobj.get_value());
            }
        },this);
    }
}

//Driver object must define a register function to instantiate a registration to a specific
//item. When these values change the driver will emit an "itemvalue".
//      
//
MbSimpleSerialSlave.prototype.register = function(item) {

    var match;
    var self = this;
        
    //n:word - Integer word
    if (match = /^n:(\d{1,3})$/.exec(item)) {
        var word = parseInt(match[1],10);
        var mask = 0xFFFF;
        self.items[item] = {
            word: word,
            len: 1,
            mask: mask,
            get_value: function (){
                return self.registers[word];
            },
            set_value: function (value){
                set_register.call(self, word, value);
            }
        };
    }
    
    //n:word.bit - Integer at word.bit
    else if (match = /^n:(\d{1,3})\.(\d{1,2})$/.exec(item)) {
        var word = parseInt(match[1],10);
        var bit = parseInt(match[2],10);
        var mask = 0x01 << bit;
        self.items[item] = {
            word: word,
            len: 1,
            mask: mask,
            get_value: function (){
                return (self.registers[word] & (0x01 << bit))?1:0;
            },
            set_value: function (value){
                var curr = self.registers[word];
                var newval = (curr & (~mask)) | ( (value<<bit) & mask);
                set_register.call(self, word, newval);
            }
        };
    }
    else {
        //self.log_err('illegal itemname:' + itemname);
    }
    //TODO - array and string types
}

//Driver must define a start method
MbSimpleSerialSlave.prototype.start =function (){
    var self = this;

    self.port.open( function (err){
        
        if (err){
            console.log('error opening port:' + err);
            //todo - should loop open
            return;
        }
    
        self.port.on("open", function () {
            console.log('opened port:' + self.port.path, self);	  
            self.port.on('data', function(data) {

                //Data will be one MODBUS ASCII frame as a string
                var result = mbcommon.preprocessASCII.call(self,data);
                if (result.err) {
                    console.log('MbSimpleSerialSlave receive error:' + result.err);
                }
                else {
                    decodeAndExecute.call(self,result.bytes);
                }
            });
        });
        
        self.port.on("close", function () {
            console.log('closed port:' + self.port.path);	  
        });  
    });
}

//Driver must define a stop method
MbSimpleSerialSlave.prototype.stop = function (){
    this.port.close();
}

//Driver must define a read_item method that provides the current value
MbSimpleSerialSlave.prototype.read_item = function (item){
    
    if (this.items[item]){
        return this.items[item].get_value();
    }
    return undefined;
}

//Driver must define a write_item method to be call by driver database
//to ask driver to write a value to an item. Read only drivers can
//throw an error or do nothing. RW drivers can throw errors or be silent for bad calls.
MbSimpleSerialSlave.prototype.write_item = function (item, value) {
        
    if (this.items[item]){
        this.items[item].set_value(value);
    }
};


//Private slave method
//Called with decodeAndExecute.call(thisvar, bytes) where thisvar is a modbus driver object
//Decode and execute a message. Preconditoon - any non-null bytes array is well formed.
//
var decodeAndExecute = function(bytes) {

    if(!bytes) return;
	
	//Is it me?
	var address = bytes[0];
	if(address!==this.address) return; //not an error.
	
    //Function code is 2nd byte
    var func_code = bytes[1];
    var handler = this.MODBUS_FUNCTIONS[func_code];
    if ( ! handler ) {
        console.log('modbus.simple illegal function code:' + func_code);
    }
    else {
        //TODO - add master timeout logic if this.timeout is being used
        handler.call(this, bytes);
    }
};

//Private handler
//Calling sequence: slaveReadMyHoldingRegisters.call(driverObj, data)
//Modbus function 0x03
var slaveReadMyHoldingRegisters = function (bytes){
    //console.log('read holding registers');
    
    var start_addr = (bytes[2]<<8) + bytes[3];
    var num_points = (bytes[4]<<8) + bytes[5];
    
    if( 0 == num_points ){
        console.log('return exception code - invalid number of registers:' + num_points);
        return false;
    }       
    
    if ( (start_addr + num_points) >= this.num_regs ){
        console.log('return exception code - start address out of range start:' + start_addr + ' registers:' + num_points);
        return false;
    }
    
    if ( num_points > 125 ){
        console.log('return exception code - too many registers requested (max=125):' + num_points);
        return false;
    }
    
    //Got to here, reply with requested registers
    var reply = [];
    reply[0] = this.address;
    reply[1] = 0x03;
    reply[2] = num_points*2;    //byte count
    for (var i=0; i<num_points; i++) {  //Insert 16 bit registers
        var idx = 3 + (2*i);
        var word = this.registers[i+start_addr];
        reply[idx] = (word & 0xFF00)>>8;
        reply[idx+1] = (word & 0x00FF);
    }
    
    //Stick on the LRC check byte
    reply.push(mbcommon.calc_lrc(reply));
    
    //Convert back to ASCII and send
    var ascii = mbcommon.convertBytesToASCII(reply);
    
    this.port.write(ascii, function(err, results) {
        //TODO - log errors? Add debug level?
    });
    
    return true; //Good poll
};

//Private handler
//Calling sequence: slaveWriteToOneOfMyRegisters.call(driverObj, data)
//Modbus functon 0x06
var slaveWriteToOneOfMyRegisters = function (bytes){

    if (7 != bytes.length) {
        console.log('return exception code - not enough bytes.');
        return false;
    }
    
    var addr = (bytes[2]<<8) + bytes[3];
    
    var value = (bytes[4]<<8) + bytes[5];
    
    if ( addr >= this.num_regs ){
        console.log('return exception code - address out of range:' + addr);
        return false;
    }

    console.log('slaveWriteToOneOfMyRegisters addr:' + addr + ' value:' + value);
        
    //Got here. Update the register value
    set_register.call(this, addr, value);
    
    //Send ack reply
    var reply = [];
    reply[0] = this.address;
    reply[1] = 0x06;
    reply[2] = bytes[2];
    reply[3] = bytes[3];

    //Stick on the LRC check byte
    reply.push(mbcommon.calc_lrc(reply));
    
    //Convert back to ASCII and send
    var ascii = mbcommon.convertBytesToASCII(reply);
    //console.log('reply:', ascii);
    
    this.port.write(ascii, function(err, results) {
        //TODO - log errors? Add debug level?
    });

    return true;
};

//Private handler
//Calling sequence: slaveWriteToMultipleOfMyRegisters.call(driverObj, data)
//Modbus function 0x10
var slaveWriteToMultipleOfMyRegisters = function(bytes){
    
    var start_addr = (bytes[2]<<8) + bytes[3];
    var num_points = (bytes[4]<<8) + bytes[5];
    var byte_count = bytes[6];
    
    if( 0 == num_points ){
        console.log('return exception code - invalid number of registers:' + num_points);
        return false;
    }       
    
    if ( (start_addr + num_points) >= this.num_regs ){
        console.log('return exception code - start address out of range start:' + start_addr + ' registers:' + num_points);
        return false;
    }
    
    if ( num_points > 125 ){
        console.log('return exception code - too many registers requested (max=125):' + num_points);
        return false;
    }
    
    if (byte_count != (2*num_points)) {
        console.log('return exception code - byte count mismatch byte count:' + byte_count + ' point:' + num_points);
        return false;
    }
    
    //Get the values and write them
    for (var i=0; i<num_points; i++) {
        var idx = 7 + (2*i);
        var word = this.registers[i+start_addr];
        
        var value = ( bytes[idx] << 8) + bytes[idx+1];
        
        set_register.call(this, start_addr+i, value);
    }

    //Send ack reply
    var reply = [];
    reply[0] = this.address;
    reply[1] = 0x10;
    reply[2] = bytes[2];
    reply[3] = bytes[3];
    reply[4] = bytes[4];
    reply[5] = bytes[5];
   
    //Stick on the LRC check byte
    reply.push(mbcommon.calc_lrc(reply));
    
    //Convert back to ASCII and send
    var ascii = mbcommon.convertBytesToASCII(reply);
    //console.log('reply:', ascii);
    
    this.port.write(ascii, function(err, results) {
        //TODO - log errors? Add debug level?
    });
    
    return true; //Good poll
};
