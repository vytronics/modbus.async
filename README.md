#modbus.async
Nodejs modbus module

Vytronics HMI compliant MODBUS driver suite. Developed for use in the design of Vytronics HMI, the 100% free, open-source SCADA initiative, but can be used just as well stand-alone.

EXPERIMENTAL - Only serial MODBUS ASCII slave works right now. More variants on the way by end of August 2014. Here is the
development roadmap:
- serial slave - Complete. Supports 0x03 and 0x06. Only ASCII mode will be supported with slave
- serial slave - Support 0x10 and also allow indexing into memory with coil read/writes
- serial master - Goal to have working by end of August
- tcp master and slave - Goal to have working early Sept.

This MODBUS library abstracts the protocol into a simple asynchronous API freeing the application from having to deal with complex state machine.

All you need to do is instantiate a modbus.async object and then subscribe to items. Changes to the items are async emitter events.

## How to use

Download the sample from https://github.com/vytronics-samples/modbus-demo.git

The following examples demonstrate use of the driver standalone and within Vytronics HMI SCADA to create
a Modbus slave driver. It is assumes that you have a Modbus serial ASCII master connected to an available serial port or
a simulator connected via a virtual serial port. For each sample you will need to
edit the serial port_name, baudrate and other serial configuration specific to your setup.

### Standalone
The following code shows how to use modbus.async in a standalone application. See the next section
for how to use the driver within the Vytronics HMI SCADA system. The following javascript can be
executed using nodejs within a folder that has modbus.async module installed.

File: stand-alone.js
```js
var mb = require('modbus.async');

//Driver config object
var slave_config = {
    type: 'serial.slave',
    mode: 'ascii',
    address: 1,
    serial_port: {
        port_name: 'COM10',
        port_options: {
            baudrate: 9600,
            dataBits: 8,
            parity: 'none'
        }
    }
};

var slave = mb.create(slave_config);

//Register various integer items
slave.register('n:0');  //register 0
slave.register('n:3');  //register 3
slave.register('n:3.0');    //register 3 bit 0

//Listener will get called anytime an above registered item changes
//value.
slave.on('itemvalue', function(itemname, value, quality){
    console.log('itemvalue name:' + itemname + ' value:' + value);
});

//Start the slave
slave.start();

//Shutdown after 10 seconds
setTimeout( function(){
    slave.stop();
}, 10000);

>>>output (assumes master writes 255 to 40004)
#######itemvalue name:n:3.1 value:1
#######itemvalue name:n:3 value:255
#######itemvalue name:n:3.0 value:1

```

### Within Vytronics HMI

Vytronics HMI is a web-enabled SCADA server and graphics client that can be deployed embedded, client-server or even in the cloud without any change in design. This driver enables the server to access local serial or Ethernet ports for Modbus interfaces to master and slave devices. The following
instructions assume you have node and npm installed on your computer and you have Internet access.

Download from github as directed in the above section or type as follows...

Create a new directory.

Paste the following contents into a file named package.json and save in the directory.
```js
{
  "dependencies": {
    "serialport": "~1.4.0",
    "vytronics.hmi": "~0.0.0",
    "modbus.async": "~0.0.0"
  }
}
```

Paste the following contents into a file named modbus-demo.js
```js
var server = require("vytronics.hmi");

server.start();
```

Create a folder named project and a file project.yml in the project folder and cut/paste JSON contents below.
```js
{
    drivers:{
        #Create a modbus slave driver named my_slave
        my_slave: {
            uri: "modbus.async" ,
            config: {
                #log_level: 'all', #see all log messages for driver
                type: 'serial.slave',
                mode: 'ascii',
                address: 1,
                serial_port: {
                    port_name: 'COM10',
                    port_options: {
                        baudrate: 9600,
                        dataBits: 8,
                        parity: 'none'
                    }
                }
            }
        }
    },
    tags: {    
        "4x0001": {
            defaultValue: 0,
            #link to driver my_slave holding register 40001
            driverinfo: { id: "my_slave", item: "n:0"}
        },
        "4x0002": {
            defaultValue: 0,
            #link to driver my_slave holding register 40002
            driverinfo: { id: "my_slave", item: "n:1"}
        },
        "4x0002.0": {
            defaultValue: 0,
            #link to driver my_slave holding register 40002 bit 0
            driverinfo: {id: "my_slave", item: "n:1.0"}
        }
    }
}
```

Open a terminal or command terminal and type the following command while in the root of your sample directory.
```
npm install
```

It will take a few minutes to download and build all of the dependencies. When it finishes you can run the SCADA system by typing the following command in the terminal:
```
node sample
```

Browse to localhost:8000/PointPanel.html to see the tags updating.



## API
Coming soon. Will include methods to create serial RTU/ASCII master and slaves as well as TCP clients and servers.

## License

AGPL
