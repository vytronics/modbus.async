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
holding register commands are supported but item indexers for registers, bits, strings and arrays willl
be supported.

Masters can interface to this slave driver using holding register or coil read/writes. Holding
registers directly access this module's registers array. Coil read/writes acess the registers as
bit-packed arrays. That is, access of coil[16] would be bit 0 of register 1.

Functions supported:

0x01 - read coil status
0x03 - read holding registers
0x05 - write single coil
0x06 - write single holding register
0x0F - write multiple coils
0x10 - write multiple holding registers
0x16 - masked write single holding register TODO future

*/
"use strict";

//Dependencies
var events = require("events");
var serialport = require("serialport");
var mbcommon = require("./mbcommon");


module.exports.create = function (config){
    
    var slave = new MbSimpleSerialSlave(config);
    
    if (!slave) return undefined;
        
    return {
        start: function (){ slave.start(); },
        stop: function (){ slave.stop(); },
        register: function (item){ slave.register(item); },
        write_item: function (item, value){ slave.write_item(item, value); },
        read_item: function (item){ return slave.read_item(item); },
        on: function (type, listener){ slave.emitter.on(type, listener); }
    };    
};

function MbSimpleSerialSlave (config){
    
    var self = this;
    
    self.items = {};
    
    //Driver 4x memory. This is what the master will actually read and write to.
    self.num_regs = 0;
    self.registers = [];
    self.registers_quality = [];
    
    //This driver can emit events
    //emit("itemvalue", item, value);
    self.emitter = new events.EventEmitter();
            
    if (!config){
        self.log_err('config object is not defined.');
        return this;
    }
    
    this.address = config.address; //TODO verify valid integer 1-255
    
    //Serial port config. If undefined then serialport will use default 9600|8|1
    var port_config = config.serial_port;
    
    self.port = new serialport.SerialPort(port_config.port_name,
                                        port_config.port_options,
                                        false, //open immediately flag set to false
                                        function(err){
                                            self.log_err('Error creating serial port ' + err);
                                        }); 
        
    //Tell serialport which parser to use
    this.mode = config.mode?config.mode.toLocaleLowerCase():undefined;
    if (this.mode === 'ascii'){
        self.port.options.parser = serialport.parsers.readline('\r\n');
        self.onData = self.onAsciiData;
    }
    else {
        //Not allowing RTU mode for slave yet since don't think serialport module can
        //provide the required timing.
        self.log_err('invalid modbus mode ' + config.mode + ' only ascii mode supported.');
        return self;
    }

    //Do not let serial port error events raise exception
    //TODO - handle these
    self.port.on('error', function (err){ self.log_err('port error ' + err); });
    
}

//Driver must define start method
MbSimpleSerialSlave.prototype.start =function (){
    var self = this;
                       
    self.port.on("open", function () {
        self.log_info('opened port:' + self.port.path);
        
        //What to do when data is on the port
        self.port.on('data', function (data) { self.onAsciiData(data) } );
    });

    self.port.on("close", function () {
        self.log_info('closed port:' + self.port.path);	  
    });              
    
    self.port.open( function (err){        
 
        if (err) {
            self.log_err('open port:' + err);
            return;
        }
        else {
            //Start someting??
        }
    });

};

//Driver must define stop method
MbSimpleSerialSlave.prototype.stop =function (){
    this.port.close();
    
    //Kill any operation timer
    if ( this.operation_timer ) {
        clearTimeout(this.operation_timer);
    }    
};

//Driver must define a read_item method to return
//the current value of an item on demand, could be cached
//Silently returns undefined if errors.
//TODO - incorporate quality
MbSimpleSerialSlave.prototype.read_item = function (itemname){
    
    var item = this.items[itemname];
    
    return item ? item.get_value() : undefined;
   
};

//Driver must define a write_item method. This is very simple for a slave driver.
//Just update the 4x memory cache and let master read it when it wants.
//Silently returns undefined if errors.
MbSimpleSerialSlave.prototype.write_item = function (itemname, value){
    
    var item = this.items[itemname];
    
    //It is an error to try and write an unregistered item. Sorry.
    if (mbcommon.isUndefined(item)) {
        this.log_warn('attempt to write to unregistered item ' + itemname);
        return;
    }
    
    //This will trigger itemvalue events on any item that is in range of the item.index. Note that items
    //can overlap. That is, there might be an item registered to word 5 and another item registered to
    //word 5 bit 3 etc.
    this.set_registers(item.index,  //starting index
                       value);      //value or array of values

};


/*
Driver must define register function.
Item names are in the general formats
    n:3.1       reference 4x register 3 bit 1
    n:3         reference 4x register 3 all 16 bits
    ---future
    s:5.10      reference a string starting at register 5 of length 10
    a:12.3      reference an array of words starting at reg 12 and length 3
*/
MbSimpleSerialSlave.prototype.register = function (itemname){
    
    var match;
    var self = this;
    
    //TODO - validate itemname does not exist or just warn and overwrite it?
    
    //n:word - Integer word
    if (match = /^n:(\d{1,3})$/.exec(itemname)) {

        var index = parseInt(match[1],10);
        var mask = 0xFFFF;  //word type is all 16 bits
        
        //Set num registers
        if (this.num_regs < (index+1)){
            this.num_regs = (index+1);
        }
        
        //Initialize cache
        if (mbcommon.isUndefined(this.registers[index])){
            this.registers[index] = 0;
            this.registers_quality[index] = mbcommon.QUALITY.BAD;
        }

        this.items[itemname] = {
            index: index,
            mask: mask,
            length: 1,
            //Extract value from registers cache
            get_value: function () {
                return self.registers[index];   
            },
            //Test if a change to registers cache would affect our item value
            isInRange: function (change_index, change_mask){
                //is in range if indexs are equal and any non-zero change mask
                return (index === change_index) && change_mask;
            }
        };

        self.log_debug('registered item name:' + itemname);
    }
    //n:word.bit - Integer at word.bit
    else if (match = /^n:(\d{1,3})\.(\d{1,2})$/.exec(itemname)) {

        var index = parseInt(match[1],10);
        var bit = parseInt(match[2], 10);
        var mask = 0x0001 << bit;       

        //Set num registers
        if (this.num_regs < (index+1)){
            this.num_regs = (index+1);
        }

        //Initialize cache
        if (mbcommon.isUndefined(this.registers[index])){
            this.registers[index] = 0;
            this.registers_quality[index] = mbcommon.QUALITY.BAD;
        }
                
        this.items[itemname] = {
            index: index,
            lenght: 1,
            mask: mask,
            //Extract value from registers cache
            get_value: function (){
                return (self.registers[index] & mask)?1:0;                
            },
            //Test if a change to registers cache would affect our item value//Test if a change to registers cache would affect our item value
            isInRange: function (change_index, change_mask){
                //is in range if indexes are equal and change mask contains a bit in our value mask
                return (index === change_index) && (mask & change_mask);
            }            
        };
        self.log_debug('registered item name:' + itemname);
    }
    else {
        self.log_err('illegal indexer in itemname:' + itemname);
    }
            
    //TODO - array and string types
};


///////////////////// Private stuff ///////////////////////////


MbSimpleSerialSlave.prototype.get_portname = function (){
    return this.port ? this.port.path : undefined;
};

//Set a register value. Need to update internal 4x cache and if
//it has changed then check to see if any registered items need
//to put out itemvalue events
//  index - starting index
//  values - value or array of values
MbSimpleSerialSlave.prototype.set_registers = function (index, values){
    
    var self = this;
    
    //If values is not an array then put it in a single element array
    if (!Array.isArray(values)) values = [values];
    
    //TODO - need a method to set all register quality to bad when master stops polling and timeout is configured.
    
    var changes = [];  //array of { index, mask } of changes
    var changed_items = []; //array of items that have changed
        
    for (var i=0; i<values.length; i++){
 
        var mask;
        var old_val = this.registers[index+i];
        var old_qual = this.registers_quality[index+i];

        //If quality was bad then now it is good and consider all bits changed.
        if (old_qual === mbcommon.QUALITY.BAD){
            this.registers_quality[index] = mbcommon.QUALITY.GOOD;
            mask = 0xFFFF;
        }
        else {
            mask = old_val ^ values[i]; //get a mask of changed bits
        }
        
        //If no change then do nothing
        if (!mask) continue;
        
        //else update value
        this.registers[index+i] = values[i];
        
        //Remember that this register is changed
        changes.push( {index: index+i, mask: mask} );
    }
    
    //Go through all the register changes and see if this would affect the value of any items.
    //Builds a list of unique items that have changed and need itemvalue events. Note that items can
    //be arrays or string so don't need to send multiple itemvalue events for one unique item.
    changes.forEach( function(change){
        Object.getOwnPropertyNames(self.items).forEach(function (itemname){
            var item = self.items[itemname];
            if (item.isInRange(change.index, change.mask)) {
                if (-1 == changed_items.indexOf(itemname)) {
                    changed_items.push(itemname);
                }
            }
        });
    });
        
    //Send out itemvalue events for items that have changed
    changed_items.forEach( function (itemname){
        var item = self.items[itemname];
        self.emitter.emit('itemvalue', itemname, item.get_value(), item.get_quality);
    });
    
}

//Called upon receipt of complete ASCII data message from master
MbSimpleSerialSlave.prototype.onAsciiData = function (data){
    
    this.log_debug('ascii data: ' + data);
    
    var result = mbcommon.preprocessASCII(data);
    
    if (result.err) {
        this.log_warn('recieved bad data:' + result.err);
        
        //FYI - don't set quality to bad. Eventually the operation
        //timeout will expire (if set in config) and then quality will
        //go bad.
        
        return;
    }
    
    //If got to here then this is a good message with good CRC
    //Only process messages for our slave address
    var addr = result.bytes[0];
    if (this.address !== addr) return;
    
    //Do function specific processing
    var func_code = result.bytes[1];
    if (func_code === 0x03) this.proc_read_holding_registers(result.bytes);
    else if (func_code === 0x06) this.proc_write_holding_register(result.bytes);
    else this.proc_illegal_func_code(result.bytes);
    
};

MbSimpleSerialSlave.prototype.proc_illegal_func_code = function (bytes){

    //TODO - send back exception code
    this.log_warn('illegal function code:' + bytes[0]);
    
};

MbSimpleSerialSlave.prototype.proc_read_holding_registers = function (bytes){
    var start = mbcommon.extract_word(bytes, 2);
    var num_reg = mbcommon.extract_word(bytes,4);
    
    //Verify request is in range
    if ( (num_reg<=0) || (num_reg>125) || ((start + num_reg) > this.num_regs ) ) {
        this.log_warn('read holding registers illegal range - ' + start + ' num reg:' + num_reg +
                     '. This slave has ' + this.num_regs + ' registers.');
        //TODO - send exception response
        
        return;
    }
        
    //send back our data
    var msg = mbcommon.build_0x03_reply(this.mode, this.address, start, num_reg, this.registers);
    this.log_debug('sending 0x03 reply - ' + msg);
    this.port.write(msg);        
};

MbSimpleSerialSlave.prototype.proc_write_holding_register = function (bytes){
    var index = mbcommon.extract_word(bytes, 2);
    var data = mbcommon.extract_word(bytes, 4);
    
    this.set_registers(index, data);
    
    //Send back reply
    var msg = mbcommon.build_0x06_reply(this.mode, this.address, index, data);
    this.log_debug('sending 0x06 reply - ' + msg);
    this.port.write(msg);        
};

MbSimpleSerialSlave.prototype.proc_write_holding_registers = function (bytes){
    var index = mbcommon.extract_word(bytes, 2);
    var num_regs = mbcommon.extract_word(bytes, 4);
    var data = mbcommon.extract_word(bytes, 4);
    var byte_count = bytes[6];
    
    if (byte_count*2 !== num_regs){
        this.log_warn('write regs byte_count*2=' + byte_count*2 +
                      ' num_regs=' + num_regs + ' mismatch.');
        //TODO - send exception query
        return;
    }
    
    var data = [];
    for (var i=0; i<num_regs; i++){
        var value = mbcommon.extract_word(bytes, (i*2)+7);
        data[i] = value;
    }
    
    this.set_registers(index, data);
    console.log('###data - ' + data.join(','));
    
    //Send back reply
    var msg = mbcommon.build_0x10_reply(this.mode, this.address, index, data);
    this.log_debug('sending 0x06 reply - ' + msg);
    this.port.write(msg);        
};


//TODO - use this to detect master not polling a block if config files has non-zero timeout
MbSimpleSerialSlave.prototype.on_operation_timeout = function (operation_info){
    this.log_warn('operation timed out:' + operation_info);

    //TODO - more?
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

//Utility functions for logging
MbSimpleSerialSlave.prototype.log_err = function () {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('serial master port:' + this.get_portname());
    mbcommon.log.error.apply(mbcommon.log, args);
};
MbSimpleSerialSlave.prototype.log_warn = function () {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('serial master port:' + this.get_portname());
    mbcommon.log.warn.apply(mbcommon.log, args);
};
MbSimpleSerialSlave.prototype.log_info = function () {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('serial master port:' + this.get_portname());
    mbcommon.log.info.apply(mbcommon.log, args);
};
MbSimpleSerialSlave.prototype.log_debug = function () {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('serial master port:' + this.get_portname());
    mbcommon.log.debug.apply(mbcommon.log, args);
};
