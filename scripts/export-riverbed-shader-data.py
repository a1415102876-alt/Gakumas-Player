"""Export riverbed shader inputs using the existing UnityPy scene exporter.

Game assets retain their original rights; this script does not grant a licence
to redistribute them. --exporter points to the gakumas-scene-export tools.
"""
import argparse
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exporter", required=True, type=Path)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    sys.path.insert(0, str(args.exporter))
    from export_scene import SceneExporter

    ex = SceneExporter(json.loads(args.plan.read_text(encoding="utf8")), 2048, 100, None)
    args.output.mkdir(parents=True, exist_ok=True)
    result = {"scene": "env_3d_adv_riverbed-00-00-noon", "water": {}, "clouds": {}}
    # Scene calibration, not a recovered Unity CPU constant. The raw volume
    # density .3 would reach 95% at ten metres; keep the nearby riverbank clear
    # until the game's uploaded _VLFogParams can be captured for comparison.
    result["depthFog"] = {"densityScale": 0.01, "source": "preview-calibration"}
    for obj in ex.env.objects:
        if obj.type.name == "Material":
            tree = ex.tree(obj)
            if tree.get("m_Name") != "m_riverbed_00_00_wtr01":
                continue
            ex.texture_props = set()
            material = ex.glb.gltf["materials"][ex.material_index(obj)]
            ex.texture_props = None
            water = result["water"] = material["extras"]["unity"]
            water["material"] = tree["m_Name"]
            # SimpleWaterFlow reads the imported RGBA channels itself. Do not
            # run the exporter's conventional normal-map unpacking or WebP.
            for name, env in tree["m_SavedProperties"]["m_TexEnvs"]:
                if name not in ("_NoiseMap", "_Normalmap", "_SubNormalmap"):
                    continue
                texture = ex.resolve(obj.assets_file, env["m_Texture"])
                filename = f"water-{name[1:].lower()}.png"
                texture.read().image.save(args.output / filename)
                water["textures"][name] = {"file": filename, "name": ex.tree(texture)["m_Name"]}
        elif obj.type.name == "MonoBehaviour" and ex.script_class(obj) == "CloudData":
            tree = ex.tree(obj)
            if tree.get("m_Name") != "sky_cloud_nature-cloud-00":
                continue
            clouds = result["clouds"]
            material = ex.resolve(obj.assets_file, tree["cloudMaterial"])
            material_index = ex.material_index(material)
            clouds["material"] = ex.glb.gltf["materials"][material_index]["extras"]["unity"]
            clouds["file"] = "clouds.glb"
            clouds["layers"] = []
            for i, layer in enumerate(tree["cloudLayers"]):
                mesh = ex.resolve(obj.assets_file, layer["mesh"])
                geo = ex.geometry(mesh)
                index = ex.mesh_index(geo, [material_index], (0, len(geo["submeshes"])))
                node = len(ex.glb.gltf["nodes"])
                ex.glb.gltf["nodes"].append({"name": f"cloud-layer-{i}", "mesh": index})
                ex.glb.gltf["scenes"][0]["nodes"].append(node)
                clouds["layers"].append({"name": f"cloud-layer-{i}", "rotateSpeed": layer["rotateSpeed"]})
    if not result["water"] or not result["clouds"]:
        raise RuntimeError("Riverbed water material or CloudData missing from dependency plan")
    ex.glb.write(args.output / "clouds.glb")
    (args.output / "shader-data.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    for file in args.output.iterdir():
        print(file.name, file.stat().st_size)


if __name__ == "__main__":
    main()
