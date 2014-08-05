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
serial.master.js

Serial RTU and ASCII master library functions.

Extreme experimental version only. Function only. Not a lot of exception and validation
yet but it is coming soon.

See README.md for usage

*/

"use strict";

//Dependencies
var events = require("events");
var serialport = require("serialport");
var mbcommon = require("./mbcommon");

/*
Create an instance of a new modbus master proxy object that only exposes the
driver interface functions and keeps all the internals private.

config = {
    port_config : { ... }, //Node serialport config object
    mode: 'ascii|rtu'
}
*/

module.exports.create = function (config){
        
    var master = new MbSimpleSerialMaster(config);
    
    if (!master) return undefined;
        
    return {
        start: function (){ master.start(); },
        stop: function (){ master.stop(); },
        register: function (item){ master.register(item); },
        write_item: function (item, value){ master.write_item(item, value); },
        read_item: function (item){ return master.read_item(item); },
        on: function (type, listener){ master.emitter.on(type, listener); }
    };
};

function MbSimpleSerialMaster (config){

    var self = this;
    
    self.port = {}; //just because error logging will try to access port field
     
    self.blocks = {};
    
    self.receive_handler = undefined;
    
    this.init_queue();
    
    //This driver can emit events
    //emit("itemvalue", item, value);
    self.emitter = new events.EventEmitter();
            
    if (!config){
        self.log_err('config object is not defined.');
        return this;
    }
    
    //Create the memory blocks
    if (config.blocks){
        Object.getOwnPropertyNames(config.blocks).forEach(function (block_name){
            var block = self.create_block(block_name, config.blocks[block_name]);
            if (block){
                self.blocks[block_name] = block;
            }
        });
    }
       
    //Serial port config. If undefined then serialport will use default 9600|8|1
    var port_config = config.serial_port;
    
    var port = new serialport.SerialPort(port_config.port_name,
                                        port_config.port_options,
                                        false, //open immediately flag set to false
                                        function(err){
                                            self.log_err('Error creating serial port ' + err);
                                        }); 
    
   //Tell serialport which parser to use
    var parser = config.mode?config.mode.toLocaleLowerCase():undefined;
    if (parser === 'ascii'){
        port.options.parser = serialport.parsers.readline('\r\n');
        self.onData = self.onAsciiData;
    }
    else if (parser === 'rtu'){
        port.options.parser = serialport.parsers.raw;
        self.onData = self.onRtuData;
    }
    else {
        self.log_err('invalid modbus mode ' + config.mode);
        return self;
    }

    //Do not let serial port error events raise exception
    //TODO - handle these
    port.on('error', function (err){ self.log_err('port error ' + err); });
    
    self.port = port;
}

//Driver must define start method
MbSimpleSerialMaster.prototype.start =function (){
    var self = this;
                       
    self.port.on("open", function () {
        self.log_info('opened port:' + self.port.path);
        
        //Push active block operations onto queue
        Object.getOwnPropertyNames(self.blocks).forEach(function (block_name){            
            var block = self.blocks[block_name];
            
            if (block.read && block.read.repeat){
                self.enqueue(block.read);
            }
            
            if (block.write_interval){
            }
            
        });
        
        self.port.on('data', function (data) { self.onData(data) } );
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
            //Start someting
        }
    });

};

//Driver must define stop method
MbSimpleSerialMaster.prototype.stop =function (){
    this.port.close();
    
    //Kill any operation timer
    if ( this.operation_timer ) {
        clearTimeout(this.operation_timer);
    }
    
    //Kill any operation repeat timers
    this.queue_timers.forEach(function (timer){
        clearTimeout(timer);
    });
    
    //Reset queue
    this.init_queue();
};

//Master must define a read_item method to return
//the current value of an item on demand, could be cached
//Silently returns undefined if errors.
//TODO - incorporate quality
MbSimpleSerialMaster.prototype.read_item = function (itemname){
    
    var item_info = mbcommon.split_itemname(itemname);
    
    var block = this.blocks[item_info.blockname];
    
    var item = block ? block.items[itemname] : undefined;
    
    return item ? item.get_value() : undefined;
   
};

/*
Driver must define register function.
Item names are in the general format: <memory block name>@<some indexer>
For example: PLC_4x@n:3.1 would reference memory block named PLC_4x and
its register at word=3, bit=1.
*/
MbSimpleSerialMaster.prototype.register = function (itemname){
    
    var match;
    var self = this;
    
    var item_info = mbcommon.split_itemname(itemname);
    
    if( (!item_info.blockname) || (!item_info.indexer) ){
        self.log_err('invalid itemname:' + itemname);
    }
    
    var block = self.blocks[item_info.blockname];
    if (!block) {
        self.log_err('Blockname is not registered:' + itemname);
    }
        
    //n:word - Integer word
    if (match = /^n:(\d{1,3})$/.exec(item_info.indexer)) {
                
        var word = parseInt(match[1],10);
        var mask = 0xFFFF;        
        block.items[itemname] = {
            word: word,
            len: 1,
            mask: mask,
            get_value: function (){
                if (block) {
                    return block.get_register(word).value;
                }
                else {
                    return undefined;
                }
            },
            set_value: function (value){
                if (!block) return;
                console.log('##########set_value block:' + item_info.blockname + ' word:' + word + ' value:' + value + ' ##TODO have to send a write-once');
            }
        };
        self.log_debug('###registered item name:' + itemname + ' item:', block.items[item_info.indexer]);
    }
    /*
    //n:word.bit - Integer at word.bit
    else if (match = /^n:(\d{1,3})\.(\d{1,2})$/.exec(indexer)) {
        var word = parseInt(match[1],10);
        var bit = parseInt(match[2],10);
        var mask = 0x01 << bit;
        block.items[item] = {
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
    }*/
    else {
        self.log_err('illegal indexer in itemname:' + itemname);
    }
    
    //TODO - array and string types
};

//////////////// Private stuff ////////////////////////////////////////

MbSimpleSerialMaster.prototype.create_block = function (name, config){
       
    if (!config) {
        this.log_err('create_block name:' + name + ' config is not defined.');
        return undefined;
    }
    
    if (config.type === '4x'){
        return this.create_4x_ASCII_block( name, config );
    }
        
    this.log_err('create_block illegal block type:' + config.type);
};
    

//Init / reset the operation queue
MbSimpleSerialMaster.prototype.init_queue= function() {
    
    var self = this;
    
    //Operation queue. This will hold operations that are ready to be sent. Can only have on send/reply
    //operation active on the port at one time so this is where we put them when ready for send.
    self.queue = [];
    self.queue_timers = []; //Any timers for dequeued operations that asked to be repeated.
    self.operation_timer = undefined; //Timer to wait for command reply
};

MbSimpleSerialMaster.prototype.onAsciiData = function (data){
    this.log_info('ascii data:' + data);
    
    //ASCII is easy. This method will only get called when the \n\r message terminator
    //is seen on the stream. Therefore all that is needed is to decode the message.
    
    //Port will only have a handler attached when there has been poll send and waiting for reply
    //Otherwise anything received is an error
    if (!this.receive_handler){
        this.log_err('unexpected data recieved on port.');
        return;
    }
    
    this.receive_handler(data);
    
};

MbSimpleSerialMaster.prototype.onRtuData = function (data){
    log_err('rtu data length:' + data.length + ' bytes:' + data);
    
    //RTU is harder. This method can be called anytime in the receive process.
    //Can receive a partial message and have to build until either it is complete
    //or there is a protocol error.
};

MbSimpleSerialMaster.prototype.on_operation_timeout = function (operation_info){
    this.log_warn('operation timed out:' + operation_info);
    this.receive_handler = undefined;
    this.operation_timer = undefined;
    this.dequeue();
};

//Create a 4x ASCII memory block
MbSimpleSerialMaster.prototype.create_4x_ASCII_block = function( name, config ){
    //TODO - validate config
            /*type: '4x',
            slave_addr: 1,
            start_reg: 5,
            num_reg: 10,
            read_interval: 5000, //milliseconds
            timeout: 2000*/

    var self = this;
    
    var items = {};

    var slave_addr = config.slave_addr;
    var start_reg = config.start_reg;
    var num_reg = config.num_reg;
    var timeout = config.timeout || mbcommon.DEFAULT_TIMEOUT;
    var read_interval = config.read_interval;
    
    //TODO validate
    
    //Data storage {value, change_mask}
    var registers = [];
    for (var i=0; i<num_reg; i++) registers[i] = { value:0, mask:0 };
    
    var quality = mbcommon.QUALITY.BAD;
    
    //Send out any itemvalues for registered items
    //new_values is undefined when quality goes bad and registers will not get updated
    var update_itemvalues = function (new_quality, new_values){
        //console.log('update_itemvalues quality:' + quality);
        var old_qual = quality;
        quality = new_quality;
        
        //Update memory
        registers.forEach( function (reg, idx){            
            var val = registers[idx].value;

            //Change mask has all bits set if qual went from bad to good
            var mask = (old_qual !== mbcommon.QUALITY.GOOD) ? 0xFFFF : (reg^val);                    

            registers[idx] = { value:reg, mask:mask };
        }); 

        //Send out itemvalue events
        registers.forEach(function (reg, idx){
            if (reg.mask){
                //self.log_debug('block ' + name + ' new value reg[' + idx + ']={value:' + reg.value.toString(16) + ' mask:' + reg.mask.toString(16) + '}');

                Object.getOwnPropertyNames(items).forEach( function (itemname){
                    var item = items[itemname];
                    if ((item.word === idx) && ( (item.mask && reg.mask))) {
                        self.emitter.emit('itemvalue', itemname, item.get_value(), quality);
                    }
                });

            }
        });
    };
    
    
    //A block can be the fixed blocks created from the driver creation (specified in the config
    //object or can be created on demand for say when the HMI wants to write a point.
    //Blocks consist of a send/receive processing pair and optional linked block. For example, a
    //read-modify-write operation has a read block which is linked to a write block if successful.
    
    var block = {
        read: {
            exec: function (){
                var send = function (){ ascii_4x_send.call(self, slave_addr, start_reg, num_reg) };
        
                send(); //send the poll

                //Timeout
                self.operation_timer = setTimeout( function (){
                    update_itemvalues(mbcommon.QUALITY.BAD);
                    self.on_operation_timeout('read4x'); //will dequeue
                }, timeout);

                //Define what to do when reply is received
                self.receive_handler = function(data){                    
                    
                    self.receive_handler = undefined;

                    clearTimeout(self.operation_timer);
                    self.operation_timer = undefined;

                    self.dequeue();

                    var new_values = ascii_4x_reply.call(self, slave_addr, start_reg, num_reg, data);

                    if ( new_values ){                        
                        update_itemvalues(mbcommon.QUALITY.GOOD, new_values);
                    }
                    else { //Read failed. Set bad quality?
                        update_itemvalues(mbcommon.QUALITY.BAD);
                    }
                    
                };                                                    
            },
            repeat: read_interval
        },
        write_once: {}, //TODO
        get_register: function (index){
            return registers[index].value;
        },
        //Set reg value on values read from slave
        set_register: function (index, value){
            register[index].value = value;
        },
        items: items,
        next_block: undefined //Next block to execute if this succeeds.
    };
    
    return block;
};



//Can only perform one send/reply operation at a time on the port. Put every operation
//on a queue. Each operation must call master.dequeue() when completed.
MbSimpleSerialMaster.prototype.enqueue = function (operation){
    this.queue.push(operation);
    
    if (1 === this.queue.length){
        //Execute right away
        operation.exec();
    }
    
    this.log_debug('enqueued queue size:' + this.queue.length);

};

MbSimpleSerialMaster.prototype.dequeue = function (){
    
    var self = this;
    
    var operation = this.queue.shift();
    
    this.log_debug('dequeued queue size:' + self.queue.length);
    
    //Does the completed operation require something new to be queued?
    if (operation.repeat){
        var timer;
        timer = setTimeout( function (){
            self.enqueue(operation);
            var idx = self.queue_timers.indexOf(timer);
            if (-1 !== idx){
                self.queue_timers.splice(idx,1);
            }
        }, operation.repeat);
                               
        self.queue_timers.push(timer);
    }
};
 
//Function to encode message bytes for a particular transport and mode
//Precondition: mode is valid
function encode_msg (mode, bytes){
    var msg = [];
    
    if (mode === 'serial.ascii'){
        bytes.push(module.exports.calc_lrc(bytes));
        return mbcommon.convertASCIItoBytes(bytes);
    }
    
    if (mode === 'serial.rtu'){
        var crc = module.exports.calc_crc(bytes);
        bytes.push((crc&0xFF00) >> 8);
        bytes.push(crc&0x00FF);
        return bytes;
    }
    
    if (mode === 'tcp'){
        return bytes;
    }
}

//function to decode message bytes
    


//Read registers
//Pre-condition will not be called if port is busy or with bad params
//Called with thisvar is the master
var ascii_4x_send = function(slave_addr, start_reg, num_reg){
    
    var bytes=[];
    
    bytes[0] = slave_addr;
    bytes[1] = 0x03; //modbus function code
    bytes[2] = (start_reg&0xFF00) >> 8;
    bytes[3] = (start_reg&0x00FF);
    bytes[4] = (num_reg&0xFF00) >> 8;
    bytes[5] = (num_reg&0x00FF);
    
    //Add LRC
    bytes[6] = mbcommon.calc_lrc(bytes);
    
    //Convert to ASCII
    var msg = mbcommon.convertBytesToASCII(bytes);
    
    this.log_debug('4x_ascii_send msg:' + msg);
    
    this.port.write(msg);
};

var ascii_4x_reply = function (slave_addr, start_reg, num_reg, data){
    this.log_debug('4x_ascii_reply msg:'+ data);
    
    var result = mbcommon.preprocessASCII(data);
    
    if (result.err){
        this.log_err('Invalid ASCII reply:' + err);
        return undefined;
    }
    
    var bytes = result.bytes;
    
    if (slave_addr !== bytes[0]) {
        this.log_warn('Reply address ' + bytes[0] + ' does not match slave address ' + slave_addr);
        return undefined;
    }
    
    if (0x03 !== bytes[1]) {
        this.log_warn('Function code mismatch. Received ' + bytes[1].toString(16) + ' expected 0x03.');
        return undefined;
    }
    
    if ( (num_reg*2) !== bytes[2]) {
        this.log_warn('Function msg size mismatch. Received ' + bytes[2].toString(16) + ' expected ' + (num_reg*2).toString(16));
        return undefined;
    }
    
    if (bytes.length !== 4 + (num_reg*2)) {
        this.log_warn('Function data size mismatch.');
        return undefined;
    }
        
    //Got to hear then recieved good data. Return 16bit values
    var registers = [];
    for (var i=0; i<(num_reg); i++){
        var idx = i*2;
        //Make 16 bit unsigned
        registers[i] = (bytes[3+idx]<<8) + bytes[4+idx];
    }
    return registers;

};

//Utility functions for logging
MbSimpleSerialMaster.prototype.log_err = function () {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('serial master port:' + this.port.path);
    mbcommon.log.error.apply(mbcommon.log, args);
};
MbSimpleSerialMaster.prototype.log_warn = function () {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('serial master port:' + this.port.path);
    mbcommon.log.warn.apply(mbcommon.log, args);
};
MbSimpleSerialMaster.prototype.log_info = function () {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('serial master port:' + this.port.path);
    mbcommon.log.info.apply(mbcommon.log, args);
};
MbSimpleSerialMaster.prototype.log_debug = function () {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('serial master port:' + this.port.path);
    mbcommon.log.debug.apply(mbcommon.log, args);
};