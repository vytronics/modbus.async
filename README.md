#modbus.async
Nodejs modbus module

Vytronics HMI compliant MODBUS driver suite. Developed for use in the design of Vytronics HMI, the 100% free, open-source SCADA initiative, but can be used just as well stand-alone.

This MODBUS library abstracts the protocol into a simple asynchronous API freeing the application from having to deal with complex state machine.

All you need to do is instantiate a modbus.async object and then subscribe to items. Changes to the items are async emitter events.

## How to use
The following examples demonstrate use of the driver standalone and within Vytronics HMI SCADA to create
a Modbus master driver. It is assumes that you have a Modbus serial ASCII slave connected to an available serial port or
a simulator connected via a virtual serial port. The sample configuration reads some holding registers every
5000 milliseconds and emits "itemvalue" events for registered items as they change. For each sample you will need to
edit the serial port_name, baudrate and other serial configuration specific to your setup.

### Standalone
The following code shows how to use modbus.async in a standalone application. See the next section
for how to use the driver within the Vytronics HMI SCADA system. The following javascript can be
executed using nodejs within a folder that has modbus.async module installed.

```js
var config = {
    type: 'serial.master',
    serial_port: { //node serialport config
        port_name: 'COM11',
        port_config: {
            baudrate: 9600
        }
    },
    mode: 'ascii',
    blocks: { //Define memory blocks
        'plc.4x': { //Give a block a meaningful name
            type: '4x',
            slave_addr: 1,
            start_reg: 5,
            num_reg: 10,
            read_interval: 5000, //milliseconds
            timeout: 2000
        }
    }
};

//Create a master driver
var master = require('modbus.async').create(config);

//Register some items you want to get 'itemvalue' events for
master.register('plc.4x@n:1');
master.register('plc.4x@n:3');

//Listener
master.on('itemvalue', function (name, value, quality){
    console.log('itemvalue name:' + name + ' value:' + value + ' quality:' + quality);
});

//Opens port(s) and starts executing the protocol
master.start();

//Shutdown after 10 seconds
setTimeout( function(){
    master.stop();
}, 10000);

>>>output
itemvalue name:plc.4x@n:1 value:0 quality:1
itemvalue name:plc.4x@n:3 value:0 quality:1

```

### Within Vytronics HMI

Vytronics HMI is a web-enabled SCADA server and graphics client that can be deployed embedded, client-server or even in the cloud without any change in design. This driver enables the server to access local serial or Ethernet ports for Modbus interfaces to master and slave devices. The following
instructions assume you have node and npm installed on your computer and you have Internet access.

Create a new directory.

Paste the following contents into a file named package.json and save in the directory.
```js
{
  "dependencies": {
    "serialport": "~1.4.0",
    "vytronics.hmi": "~0.0.0",
    "modbus.async": "~0.0.0"
  },
}
```

Paste the following contents into a file named sample.js
```js
var server = require("vytronics.hmi");

server.start();
```

Open up the file project.json in the project folder and cut/paste to replace its contents with the JSON file below.
```js
{
  "drivers":{
    "mb_master": {
      "type": "serial.master",
      "serial_port": {
        "port_name": "COM11",
        "port_config": {
          "baudrate": 9600
        }
      },
      "mode": "ascii",
      "blocks": {
        "plc.4x": {
          "type": "4x",
          "slave_addr": 1,
          "start_reg": 5,
          "num_reg": 10,
          "read_interval": 5000,
          "timeout": 2000
        }
      }
    }
  },
  "tags": {
    "my_tag1": {
      "defaultValue": 0,
      "driverinfo": {"id":"mb_master", "item":"plc.4x@n:1"}
    },
    "my_tag2": {
      "defaultValue": 0,
      "driverinfo": {"id":"mb_master", "item":"plc.4x@n:3"}
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
