#!/usr/bin/env node

'use strict';

var raml = require('raml-parser');
var handlebars = require('handlebars');
var hljs = require('highlight.js');
var marked = require('marked');
var program = require('commander');
var fs = require('fs');
var consolidate = require('consolidate');
var resolve = require('path').resolve;

function parseBaseUri(ramlObj) {
    // I have no clue what kind of variables the RAML spec allows in the baseUri.
    // For now keep it super super simple.
    if (ramlObj.baseUri){
        ramlObj.baseUri = ramlObj.baseUri.replace('{version}', ramlObj.version);
    }
    return ramlObj;
}

function makeUniqueId(resource) {
    var fullUrl = resource.parentUrl + resource.relativeUri;
    return fullUrl.replace(/\W/g, '_');
}

function traverse(ramlObj, parentUrl, allUriParameters) {
    var resource, index;
    for (index in ramlObj.resources) {
        if (ramlObj.resources.hasOwnProperty(index)) {
            resource = ramlObj.resources[index];
            resource.parentUrl = parentUrl || '';
            resource.uniqueId = makeUniqueId(resource);
            resource.allUriParameters = [];

            if (allUriParameters) {
                resource.allUriParameters.push.apply(resource.allUriParameters, allUriParameters);
            }

            if (resource.uriParameters) {
                var key;
                for (key in resource.uriParameters) {
                    resource.allUriParameters.push(resource.uriParameters[key]);
                }
            }

            traverse(resource, resource.parentUrl + resource.relativeUri, resource.allUriParameters);
        }
    }

    return ramlObj;
}

function markDownHelper(text) {
    if (text && text.length) {
        return new handlebars.SafeString(marked(text));
    } else {
        return '';
    }
}

function highlightHelper(text) {
    if (text && text.length) {
        return new handlebars.SafeString(hljs.highlightAuto(text).value);
    } else {
        return '';
    }
}

function lockIconHelper(securedBy) {
    if (securedBy && securedBy.length) {
        var index = securedBy.indexOf(null);
        if (index !== -1) {
            securedBy.splice(index, 1);
        }

        if (securedBy.length) {
            return new handlebars.SafeString(' <span class="glyphicon glyphicon-lock" title="Authentication required"></span>');
        }
    }

    return '';
}

function compileRamlObj(ramlObj, config, onSuccess, onError) {
    ramlObj = parseBaseUri(ramlObj);
    ramlObj = traverse(ramlObj);
    ramlObj.config = config;

    // Register handlebar helpers
    for (var helperName in config.helpers) {
        if (config.helpers.hasOwnProperty(helperName)) {
            handlebars.registerHelper(helperName, config.helpers[helperName]);
        }
    }

    // Register handlebar partials
    for (var partialName in config.partials) {
        if (config.partials.hasOwnProperty(partialName)) {
            handlebars.registerPartial(partialName, config.partials[partialName]);
        }
    }

    if (config.templateEngine != 'handlebars') {
        ramlObj.helpers = config.helpers;
    }
    if (config.templateOptions) {
        for (var k in config.templateOptions) {
            ramlObj[k] = config.templateOptions[k];
        }
    }
    consolidate[config.templateEngine](config.template, ramlObj, function(err, html) {
        if (err) return onError(err);
        onSuccess(html);
    });
}

function sourceToRamlObj(source, onSuccess, onError) {
    if (typeof(source) === 'string') {
        if (fs.existsSync(source)) {
            // Parse as file
            raml.loadFile(source).then(onSuccess, onError);
        } else {
            // Parse as string or buffer
            raml.load('' + source).then(onSuccess, onError);
        }
    } else if (source instanceof Buffer) {
        // Parse as buffer
        raml.load('' + source).then(onSuccess, onError);
    } else if (typeof(source) === 'object') {
        // Parse RAML object directly
        process.nextTick(function() {
            onSuccess(source);
        });
    } else {
        onError(new Error('sourceToRamlObj: You must supply either file, data or obj as source.'));
    }
}

function parseWithConfig(source, config, onSuccess, onError) {
    sourceToRamlObj(source, function(ramlObj) {
        compileRamlObj(ramlObj, config, onSuccess, onError);
    }, onError);
}

function parse(source, onSuccess, onError) {
    var resourceTemplate = require('./resource.handlebars');

    var config = {
        'template': resolve(__dirname, 'template.handlebars'),
        'templateEngine': 'handlebars',
        'templateOptions': {},
        'helpers': {
            'md': markDownHelper,
            'highlight': highlightHelper,
            'lock': lockIconHelper
        },
        'partials': {
            'resource': resourceTemplate
        }
    };

    parseWithConfig(source, config, onSuccess, onError);
}


if (require.main === module) {
    program
        .usage('[options] [RAML input file]')
        .option('-i, --input [input]', 'RAML input file')
        .option('-o, --output [output]', 'HTML output file')
        //.option('-t, --template [template]', 'Template file to use') // for the future :)
        .parse(process.argv);

    var input = program.input;

    if (!input) {
        if (program.args.length !== 1) {
            console.error('Error: You need to specify the RAML input file');
            program.help();
            process.exit(1);
        }

        input = program.args[0];
    }

    // Start the parsing process
    parse(input, function(result) {
        if (program.output) {
            fs.writeFileSync(program.output, result);
        } else {
            // Simply output to console
            process.stdout.write(result);
            process.exit(0);
        }
    }, function(error) {
        console.log('Error parsing: ' + error);
        process.exit(1);
    });
}


module.exports.parse = parse;
module.exports.parseWithConfig = parseWithConfig;
