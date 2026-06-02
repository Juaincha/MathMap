fetch("../graph.json")
    .then(response => response.json())
    .then(graph => {

        const elements = [];

        graph.nodes.forEach(node => {
            elements.push({
                data: {
                    id: node.id,
                    label: node.label
                }
            });
        });

        graph.edges.forEach(edge => {
            elements.push({
                data: {
                    source: edge.source,
                    target: edge.target
                }
            });
        });

        const cy = cytoscape({
            container: document.getElementById("cy"),

            elements: elements,

            style: [

                {
                    selector: "node",
                    style: {
                        label: "data(label)"
                    }
                },

                {
                    selector: "edge",
                    style: {
                        "target-arrow-shape": "triangle",
                        "curve-style": "bezier"
                    }
                }

            ],

            layout: {
                name: "cose"
            }
        });



    });