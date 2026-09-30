"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebUSBDevice = void 0;
var usb = require("../usb");
var util_1 = require("util");
var LIBUSB_TRANSFER_TYPE_MASK = 0x03;
var ENDPOINT_NUMBER_MASK = 0x7f;
var CLEAR_FEATURE = 0x01;
var ENDPOINT_HALT = 0x00;
/**
 * Wrapper to make a node-usb device look like a webusb device
 */
var WebUSBDevice = /** @class */ (function () {
    function WebUSBDevice(device) {
        this.device = device;
        this.configurations = [];
        var usbVersion = this.decodeVersion(device.deviceDescriptor.bcdUSB);
        this.usbVersionMajor = usbVersion.major;
        this.usbVersionMinor = usbVersion.minor;
        this.usbVersionSubminor = usbVersion.sub;
        this.deviceClass = device.deviceDescriptor.bDeviceClass;
        this.deviceSubclass = device.deviceDescriptor.bDeviceSubClass;
        this.deviceProtocol = device.deviceDescriptor.bDeviceProtocol;
        this.vendorId = device.deviceDescriptor.idVendor;
        this.productId = device.deviceDescriptor.idProduct;
        var deviceVersion = this.decodeVersion(device.deviceDescriptor.bcdDevice);
        this.deviceVersionMajor = deviceVersion.major;
        this.deviceVersionMinor = deviceVersion.minor;
        this.deviceVersionSubminor = deviceVersion.sub;
    }
    WebUSBDevice.createInstance = function (device) {
        return __awaiter(this, void 0, void 0, function () {
            var instance, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        instance = new WebUSBDevice(device);
                        return [4 /*yield*/, instance.initialize()];
                    case 1:
                        _b.sent();
                        return [2 /*return*/, instance];
                    case 2:
                        _a = _b.sent();
                        return [2 /*return*/, undefined];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    Object.defineProperty(WebUSBDevice.prototype, "configuration", {
        get: function () {
            if (!this.device.configDescriptor) {
                return undefined;
            }
            var currentConfiguration = this.device.configDescriptor.bConfigurationValue;
            return this.configurations.find(function (configuration) { return configuration.configurationValue === currentConfiguration; });
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(WebUSBDevice.prototype, "opened", {
        get: function () {
            return (!!this.device.interfaces);
        },
        enumerable: false,
        configurable: true
    });
    WebUSBDevice.prototype.open = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                try {
                    if (this.opened) {
                        return [2 /*return*/];
                    }
                    this.device.open();
                }
                catch (error) {
                    throw new Error("open error: " + error);
                }
                return [2 /*return*/];
            });
        });
    };
    WebUSBDevice.prototype.close = function () {
        var _a;
        return __awaiter(this, void 0, void 0, function () {
            var _b, _c, iface, e_1_1, _error_1, error_1;
            var e_1, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        _e.trys.push([0, 12, , 13]);
                        if (!this.opened) {
                            return [2 /*return*/];
                        }
                        _e.label = 1;
                    case 1:
                        _e.trys.push([1, 10, , 11]);
                        if (!this.configuration) return [3 /*break*/, 9];
                        _e.label = 2;
                    case 2:
                        _e.trys.push([2, 7, 8, 9]);
                        _b = __values((_a = this.configuration) === null || _a === void 0 ? void 0 : _a.interfaces), _c = _b.next();
                        _e.label = 3;
                    case 3:
                        if (!!_c.done) return [3 /*break*/, 6];
                        iface = _c.value;
                        return [4 /*yield*/, this._releaseInterface(iface.interfaceNumber)];
                    case 4:
                        _e.sent();
                        // Re-create the USBInterface to set the claimed attribute
                        this.configuration.interfaces[this.configuration.interfaces.indexOf(iface)] = {
                            interfaceNumber: iface.interfaceNumber,
                            alternate: iface.alternate,
                            alternates: iface.alternates,
                            claimed: false
                        };
                        _e.label = 5;
                    case 5:
                        _c = _b.next();
                        return [3 /*break*/, 3];
                    case 6: return [3 /*break*/, 9];
                    case 7:
                        e_1_1 = _e.sent();
                        e_1 = { error: e_1_1 };
                        return [3 /*break*/, 9];
                    case 8:
                        try {
                            if (_c && !_c.done && (_d = _b.return)) _d.call(_b);
                        }
                        finally { if (e_1) throw e_1.error; }
                        return [7 /*endfinally*/];
                    case 9: return [3 /*break*/, 11];
                    case 10:
                        _error_1 = _e.sent();
                        return [3 /*break*/, 11];
                    case 11:
                        this.device.close();
                        return [3 /*break*/, 13];
                    case 12:
                        error_1 = _e.sent();
                        throw new Error("close error: " + error_1);
                    case 13: return [2 /*return*/];
                }
            });
        });
    };
    WebUSBDevice.prototype.selectConfiguration = function (configurationValue) {
        return __awaiter(this, void 0, void 0, function () {
            var config, setConfiguration, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.opened || !this.device.configDescriptor) {
                            throw new Error('selectConfiguration error: invalid state');
                        }
                        if (this.device.configDescriptor.bConfigurationValue === configurationValue) {
                            return [2 /*return*/];
                        }
                        config = this.configurations.find(function (configuration) { return configuration.configurationValue === configurationValue; });
                        if (!config) {
                            throw new Error('selectConfiguration error: configuration not found');
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        setConfiguration = util_1.promisify(this.device.setConfiguration).bind(this.device);
                        return [4 /*yield*/, setConfiguration(configurationValue)];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        error_2 = _a.sent();
                        throw new Error("selectConfiguration error: " + error_2);
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    WebUSBDevice.prototype.claimInterface = function (interfaceNumber) {
        return __awaiter(this, void 0, void 0, function () {
            var iface;
            return __generator(this, function (_a) {
                if (!this.opened) {
                    throw new Error('claimInterface error: invalid state');
                }
                if (!this.configuration) {
                    throw new Error('claimInterface error: interface not found');
                }
                iface = this.configuration.interfaces.find(function (usbInterface) { return usbInterface.interfaceNumber === interfaceNumber; });
                if (!iface) {
                    throw new Error('claimInterface error: interface not found');
                }
                if (iface.claimed) {
                    return [2 /*return*/];
                }
                try {
                    this.device.interface(interfaceNumber).claim();
                    // Re-create the USBInterface to set the claimed attribute
                    this.configuration.interfaces[this.configuration.interfaces.indexOf(iface)] = {
                        interfaceNumber: interfaceNumber,
                        alternate: iface.alternate,
                        alternates: iface.alternates,
                        claimed: true
                    };
                }
                catch (error) {
                    throw new Error("claimInterface error: " + error);
                }
                return [2 /*return*/];
            });
        });
    };
    WebUSBDevice.prototype.releaseInterface = function (interfaceNumber) {
        return __awaiter(this, void 0, void 0, function () {
            var iface;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this._releaseInterface(interfaceNumber)];
                    case 1:
                        _a.sent();
                        if (this.configuration) {
                            iface = this.configuration.interfaces.find(function (usbInterface) { return usbInterface.interfaceNumber === interfaceNumber; });
                            if (iface) {
                                // Re-create the USBInterface to set the claimed attribute
                                this.configuration.interfaces[this.configuration.interfaces.indexOf(iface)] = {
                                    interfaceNumber: interfaceNumber,
                                    alternate: iface.alternate,
                                    alternates: iface.alternates,
                                    claimed: false
                                };
                            }
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    WebUSBDevice.prototype.selectAlternateInterface = function (interfaceNumber, alternateSetting) {
        return __awaiter(this, void 0, void 0, function () {
            var iface, iface_1, setAltSetting, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.opened) {
                            throw new Error('selectAlternateInterface error: invalid state');
                        }
                        if (!this.configuration) {
                            throw new Error('selectAlternateInterface error: interface not found');
                        }
                        iface = this.configuration.interfaces.find(function (usbInterface) { return usbInterface.interfaceNumber === interfaceNumber; });
                        if (!iface) {
                            throw new Error('selectAlternateInterface error: interface not found');
                        }
                        if (!iface.claimed) {
                            throw new Error('selectAlternateInterface error: invalid state');
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        iface_1 = this.device.interface(interfaceNumber);
                        setAltSetting = util_1.promisify(iface_1.setAltSetting).bind(iface_1);
                        return [4 /*yield*/, setAltSetting(alternateSetting)];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        error_3 = _a.sent();
                        throw new Error("selectAlternateInterface error: " + error_3);
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    WebUSBDevice.prototype.controlTransferIn = function (setup, length) {
        return __awaiter(this, void 0, void 0, function () {
            var type, controlTransfer, result, error_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        type = this.controlTransferParamsToType(setup, usb.LIBUSB_ENDPOINT_IN);
                        controlTransfer = util_1.promisify(this.device.controlTransfer).bind(this.device);
                        return [4 /*yield*/, controlTransfer(type, setup.request, setup.value, setup.index, length)];
                    case 1:
                        result = _a.sent();
                        return [2 /*return*/, {
                                data: result ? new DataView(new Uint8Array(result).buffer) : undefined,
                                status: 'ok'
                            }];
                    case 2:
                        error_4 = _a.sent();
                        if (error_4.errno === usb.LIBUSB_TRANSFER_STALL) {
                            return [2 /*return*/, {
                                    status: 'stall'
                                }];
                        }
                        if (error_4.errno === usb.LIBUSB_TRANSFER_OVERFLOW) {
                            return [2 /*return*/, {
                                    status: 'babble'
                                }];
                        }
                        throw new Error("controlTransferIn error: " + error_4);
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    WebUSBDevice.prototype.controlTransferOut = function (setup, data) {
        return __awaiter(this, void 0, void 0, function () {
            var type, controlTransfer, buffer, bytesWritten, error_5;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        type = this.controlTransferParamsToType(setup, usb.LIBUSB_ENDPOINT_OUT);
                        controlTransfer = util_1.promisify(this.device.controlTransfer).bind(this.device);
                        buffer = data ? Buffer.from(data) : Buffer.alloc(0);
                        return [4 /*yield*/, controlTransfer(type, setup.request, setup.value, setup.index, buffer)];
                    case 1:
                        bytesWritten = _a.sent();
                        return [2 /*return*/, {
                                bytesWritten: bytesWritten,
                                status: 'ok'
                            }];
                    case 2:
                        error_5 = _a.sent();
                        if (error_5.errno === usb.LIBUSB_TRANSFER_STALL) {
                            return [2 /*return*/, {
                                    bytesWritten: 0,
                                    status: 'stall'
                                }];
                        }
                        throw new Error("controlTransferOut error: " + error_5);
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    WebUSBDevice.prototype.clearHalt = function (direction, endpointNumber) {
        return __awaiter(this, void 0, void 0, function () {
            var wIndex, controlTransfer, error_6;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        wIndex = endpointNumber | (direction === 'in' ? usb.LIBUSB_ENDPOINT_IN : usb.LIBUSB_ENDPOINT_OUT);
                        controlTransfer = util_1.promisify(this.device.controlTransfer).bind(this.device);
                        return [4 /*yield*/, controlTransfer(usb.LIBUSB_RECIPIENT_ENDPOINT, CLEAR_FEATURE, ENDPOINT_HALT, wIndex, Buffer.from([]))];
                    case 1:
                        _a.sent();
                        return [3 /*break*/, 3];
                    case 2:
                        error_6 = _a.sent();
                        throw new Error("clearHalt error: " + error_6);
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    WebUSBDevice.prototype.transferIn = function (endpointNumber, length) {
        return __awaiter(this, void 0, void 0, function () {
            var endpoint, transfer, result, error_7;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        endpoint = this.getEndpoint(endpointNumber | usb.LIBUSB_ENDPOINT_IN);
                        transfer = util_1.promisify(endpoint.transfer).bind(endpoint);
                        return [4 /*yield*/, transfer(length)];
                    case 1:
                        result = _a.sent();
                        return [2 /*return*/, {
                                data: result ? new DataView(new Uint8Array(result).buffer) : undefined,
                                status: 'ok'
                            }];
                    case 2:
                        error_7 = _a.sent();
                        if (error_7.errno === usb.LIBUSB_TRANSFER_STALL) {
                            return [2 /*return*/, {
                                    status: 'stall'
                                }];
                        }
                        if (error_7.errno === usb.LIBUSB_TRANSFER_OVERFLOW) {
                            return [2 /*return*/, {
                                    status: 'babble'
                                }];
                        }
                        throw new Error("transferIn error: " + error_7);
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    WebUSBDevice.prototype.transferOut = function (endpointNumber, data) {
        return __awaiter(this, void 0, void 0, function () {
            var endpoint, transfer, buffer, bytesWritten, error_8;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        endpoint = this.getEndpoint(endpointNumber | usb.LIBUSB_ENDPOINT_OUT);
                        transfer = util_1.promisify(endpoint.transfer).bind(endpoint);
                        buffer = Buffer.from(data);
                        return [4 /*yield*/, transfer(buffer)];
                    case 1:
                        bytesWritten = _a.sent();
                        return [2 /*return*/, {
                                bytesWritten: bytesWritten,
                                status: 'ok'
                            }];
                    case 2:
                        error_8 = _a.sent();
                        if (error_8.errno === usb.LIBUSB_TRANSFER_STALL) {
                            return [2 /*return*/, {
                                    bytesWritten: 0,
                                    status: 'stall'
                                }];
                        }
                        throw new Error("transferOut error: " + error_8);
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    WebUSBDevice.prototype.reset = function () {
        return __awaiter(this, void 0, void 0, function () {
            var reset, error_9;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        reset = util_1.promisify(this.device.reset).bind(this.device);
                        return [4 /*yield*/, reset()];
                    case 1:
                        _a.sent();
                        return [3 /*break*/, 3];
                    case 2:
                        error_9 = _a.sent();
                        throw new Error("reset error: " + error_9);
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    WebUSBDevice.prototype.isochronousTransferIn = function (_endpointNumber, _packetLengths) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                throw new Error('isochronousTransferIn error: method not implemented');
            });
        });
    };
    WebUSBDevice.prototype.isochronousTransferOut = function (_endpointNumber, _data, _packetLengths) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                throw new Error('isochronousTransferOut error: method not implemented');
            });
        });
    };
    WebUSBDevice.prototype.forget = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                throw new Error('forget error: method not implemented');
            });
        });
    };
    WebUSBDevice.prototype.initialize = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, _b, _c, _d, error_10;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        _e.trys.push([0, 5, 6, 7]);
                        if (!this.opened) {
                            this.device.open();
                        }
                        _a = this;
                        return [4 /*yield*/, this.getStringDescriptor(this.device.deviceDescriptor.iManufacturer)];
                    case 1:
                        _a.manufacturerName = _e.sent();
                        _b = this;
                        return [4 /*yield*/, this.getStringDescriptor(this.device.deviceDescriptor.iProduct)];
                    case 2:
                        _b.productName = _e.sent();
                        _c = this;
                        return [4 /*yield*/, this.getStringDescriptor(this.device.deviceDescriptor.iSerialNumber)];
                    case 3:
                        _c.serialNumber = _e.sent();
                        _d = this;
                        return [4 /*yield*/, this.getConfigurations()];
                    case 4:
                        _d.configurations = _e.sent();
                        return [3 /*break*/, 7];
                    case 5:
                        error_10 = _e.sent();
                        throw new Error("initialize error: " + error_10);
                    case 6:
                        if (this.opened) {
                            this.device.close();
                        }
                        return [7 /*endfinally*/];
                    case 7: return [2 /*return*/];
                }
            });
        });
    };
    WebUSBDevice.prototype.decodeVersion = function (version) {
        var hex = ("0000" + version.toString(16)).slice(-4);
        return {
            major: parseInt(hex.substr(0, 2), undefined),
            minor: parseInt(hex.substr(2, 1), undefined),
            sub: parseInt(hex.substr(3, 1), undefined),
        };
    };
    WebUSBDevice.prototype.getStringDescriptor = function (index) {
        return __awaiter(this, void 0, void 0, function () {
            var getStringDescriptor, buffer, error_11;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        getStringDescriptor = util_1.promisify(this.device.getStringDescriptor).bind(this.device);
                        return [4 /*yield*/, getStringDescriptor(index)];
                    case 1:
                        buffer = _a.sent();
                        return [2 /*return*/, buffer ? buffer.toString() : ''];
                    case 2:
                        error_11 = _a.sent();
                        return [2 /*return*/, ''];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    WebUSBDevice.prototype.getConfigurations = function () {
        return __awaiter(this, void 0, void 0, function () {
            var configs, _a, _b, config, interfaces, _loop_1, this_1, _c, _d, iface, e_2_1, _e, _f, e_3_1;
            var e_3, _g, e_2, _h, _j;
            var _this = this;
            return __generator(this, function (_k) {
                switch (_k.label) {
                    case 0:
                        configs = [];
                        _k.label = 1;
                    case 1:
                        _k.trys.push([1, 14, 15, 16]);
                        _a = __values(this.device.allConfigDescriptors), _b = _a.next();
                        _k.label = 2;
                    case 2:
                        if (!!_b.done) return [3 /*break*/, 13];
                        config = _b.value;
                        interfaces = [];
                        _loop_1 = function (iface) {
                            var alternates, iface_2, iface_2_1, alternate_1, endpoints, _l, _m, endpoint, _o, _p, e_4_1, interfaceNumber, alternate;
                            var e_4, _q, e_5, _r, _s;
                            return __generator(this, function (_t) {
                                switch (_t.label) {
                                    case 0:
                                        alternates = [];
                                        _t.label = 1;
                                    case 1:
                                        _t.trys.push([1, 6, 7, 8]);
                                        iface_2 = (e_4 = void 0, __values(iface)), iface_2_1 = iface_2.next();
                                        _t.label = 2;
                                    case 2:
                                        if (!!iface_2_1.done) return [3 /*break*/, 5];
                                        alternate_1 = iface_2_1.value;
                                        endpoints = [];
                                        try {
                                            for (_l = (e_5 = void 0, __values(alternate_1.endpoints)), _m = _l.next(); !_m.done; _m = _l.next()) {
                                                endpoint = _m.value;
                                                endpoints.push({
                                                    endpointNumber: endpoint.bEndpointAddress & ENDPOINT_NUMBER_MASK,
                                                    direction: endpoint.bEndpointAddress & usb.LIBUSB_ENDPOINT_IN ? 'in' : 'out',
                                                    type: (endpoint.bmAttributes & LIBUSB_TRANSFER_TYPE_MASK) === usb.LIBUSB_TRANSFER_TYPE_BULK ? 'bulk'
                                                        : (endpoint.bmAttributes & LIBUSB_TRANSFER_TYPE_MASK) === usb.LIBUSB_TRANSFER_TYPE_INTERRUPT ? 'interrupt'
                                                            : 'isochronous',
                                                    packetSize: endpoint.wMaxPacketSize
                                                });
                                            }
                                        }
                                        catch (e_5_1) { e_5 = { error: e_5_1 }; }
                                        finally {
                                            try {
                                                if (_m && !_m.done && (_r = _l.return)) _r.call(_l);
                                            }
                                            finally { if (e_5) throw e_5.error; }
                                        }
                                        _p = (_o = alternates).push;
                                        _s = {
                                            alternateSetting: alternate_1.bAlternateSetting,
                                            interfaceClass: alternate_1.bInterfaceClass,
                                            interfaceSubclass: alternate_1.bInterfaceSubClass,
                                            interfaceProtocol: alternate_1.bInterfaceProtocol
                                        };
                                        return [4 /*yield*/, this_1.getStringDescriptor(alternate_1.iInterface)];
                                    case 3:
                                        _p.apply(_o, [(_s.interfaceName = _t.sent(),
                                                _s.endpoints = endpoints,
                                                _s)]);
                                        _t.label = 4;
                                    case 4:
                                        iface_2_1 = iface_2.next();
                                        return [3 /*break*/, 2];
                                    case 5: return [3 /*break*/, 8];
                                    case 6:
                                        e_4_1 = _t.sent();
                                        e_4 = { error: e_4_1 };
                                        return [3 /*break*/, 8];
                                    case 7:
                                        try {
                                            if (iface_2_1 && !iface_2_1.done && (_q = iface_2.return)) _q.call(iface_2);
                                        }
                                        finally { if (e_4) throw e_4.error; }
                                        return [7 /*endfinally*/];
                                    case 8:
                                        interfaceNumber = iface[0].bInterfaceNumber;
                                        alternate = alternates.find(function (alt) { return alt.alternateSetting === _this.device.interface(interfaceNumber).altSetting; });
                                        if (alternate) {
                                            interfaces.push({
                                                interfaceNumber: interfaceNumber,
                                                alternate: alternate,
                                                alternates: alternates,
                                                claimed: false
                                            });
                                        }
                                        return [2 /*return*/];
                                }
                            });
                        };
                        this_1 = this;
                        _k.label = 3;
                    case 3:
                        _k.trys.push([3, 8, 9, 10]);
                        _c = (e_2 = void 0, __values(config.interfaces)), _d = _c.next();
                        _k.label = 4;
                    case 4:
                        if (!!_d.done) return [3 /*break*/, 7];
                        iface = _d.value;
                        return [5 /*yield**/, _loop_1(iface)];
                    case 5:
                        _k.sent();
                        _k.label = 6;
                    case 6:
                        _d = _c.next();
                        return [3 /*break*/, 4];
                    case 7: return [3 /*break*/, 10];
                    case 8:
                        e_2_1 = _k.sent();
                        e_2 = { error: e_2_1 };
                        return [3 /*break*/, 10];
                    case 9:
                        try {
                            if (_d && !_d.done && (_h = _c.return)) _h.call(_c);
                        }
                        finally { if (e_2) throw e_2.error; }
                        return [7 /*endfinally*/];
                    case 10:
                        _f = (_e = configs).push;
                        _j = {
                            configurationValue: config.bConfigurationValue
                        };
                        return [4 /*yield*/, this.getStringDescriptor(config.iConfiguration)];
                    case 11:
                        _f.apply(_e, [(_j.configurationName = _k.sent(),
                                _j.interfaces = interfaces,
                                _j)]);
                        _k.label = 12;
                    case 12:
                        _b = _a.next();
                        return [3 /*break*/, 2];
                    case 13: return [3 /*break*/, 16];
                    case 14:
                        e_3_1 = _k.sent();
                        e_3 = { error: e_3_1 };
                        return [3 /*break*/, 16];
                    case 15:
                        try {
                            if (_b && !_b.done && (_g = _a.return)) _g.call(_a);
                        }
                        finally { if (e_3) throw e_3.error; }
                        return [7 /*endfinally*/];
                    case 16: return [2 /*return*/, configs];
                }
            });
        });
    };
    WebUSBDevice.prototype.getEndpoint = function (address) {
        var e_6, _a;
        if (!this.device.interfaces) {
            return undefined;
        }
        try {
            for (var _b = __values(this.device.interfaces), _c = _b.next(); !_c.done; _c = _b.next()) {
                var iface = _c.value;
                var endpoint = iface.endpoint(address);
                if (endpoint) {
                    return endpoint;
                }
            }
        }
        catch (e_6_1) { e_6 = { error: e_6_1 }; }
        finally {
            try {
                if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
            }
            finally { if (e_6) throw e_6.error; }
        }
        return undefined;
    };
    WebUSBDevice.prototype.controlTransferParamsToType = function (setup, direction) {
        var recipient = setup.recipient === 'device' ? usb.LIBUSB_RECIPIENT_DEVICE
            : setup.recipient === 'interface' ? usb.LIBUSB_RECIPIENT_INTERFACE
                : setup.recipient === 'endpoint' ? usb.LIBUSB_RECIPIENT_ENDPOINT
                    : usb.LIBUSB_RECIPIENT_OTHER;
        var requestType = setup.requestType === 'standard' ? usb.LIBUSB_REQUEST_TYPE_STANDARD
            : setup.requestType === 'class' ? usb.LIBUSB_REQUEST_TYPE_CLASS
                : usb.LIBUSB_REQUEST_TYPE_VENDOR;
        return recipient | requestType | direction;
    };
    WebUSBDevice.prototype._releaseInterface = function (interfaceNumber) {
        return __awaiter(this, void 0, void 0, function () {
            var iface, iface_3, release, error_12;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.opened) {
                            throw new Error('releaseInterface error: invalid state');
                        }
                        if (!this.configuration) {
                            throw new Error('releaseInterface error: interface not found');
                        }
                        iface = this.configuration.interfaces.find(function (usbInterface) { return usbInterface.interfaceNumber === interfaceNumber; });
                        if (!iface) {
                            throw new Error('releaseInterface error: interface not found');
                        }
                        if (!iface.claimed) {
                            return [2 /*return*/];
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        iface_3 = this.device.interface(interfaceNumber);
                        release = util_1.promisify(iface_3.release).bind(iface_3);
                        return [4 /*yield*/, release()];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        error_12 = _a.sent();
                        throw new Error("releaseInterface error: " + error_12);
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    return WebUSBDevice;
}());
exports.WebUSBDevice = WebUSBDevice;
//# sourceMappingURL=webusb-device.js.map
