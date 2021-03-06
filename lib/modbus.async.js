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

"use strict";

var mbcommon = require('./mbcommon');


//Simple MODBUS serial driver
//
//
module.exports.version = "0.0.0.0";
console.log("hello from modbus.simple driver.");

//Driver must export a create routine that constructs from a config object.
//config = {
//	interval: number - Optional loop interval in milliseconds. Default = 1000.
//}
//
module.exports.create = function(config) {
    
    //Allow module log level to be set in config. Not that
    //this globally sets the level and another config may
    //overwrite it. TODO maybe allow it to be set by signal also.
    //TODO - maybe make this at the driver DB level for driver
    //instances.
    var log_level = config.log_level;
    if ( mbcommon.isDefined(log_level) ) {
        mbcommon.log.setLevel(log_level);
    };
    
    //TODO - validate config.type field
    var driver_module = './' + config.type;
    
    var driver_obj = require(driver_module).create(config);
   
    return driver_obj;
    
}

//Just for development and deployment to see which ports are available on the
//host computer. Can run in a node interactive session like so
//  > var mb = require('modbus.async');
//  > mb.listPorts();
//  
//
module.exports.listPorts = function() {
    console.log('Listing serial ports on device:');
    var serialPort = require("serialport");
    serialPort.list(function (err, ports) {
      ports.forEach(function(port) {
        console.log(port.comName);
        console.log(port.pnpId);
        console.log(port.manufacturer);
      });
    });    
}

