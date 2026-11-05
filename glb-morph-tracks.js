// GLTFLoader splits material primitives into meshes with independent weights.
export function bindGlbMorphTracks(clip, sourceDictionary, root) {
    const targets = [];
    root.traverse(node => {
        if (node.isMesh && node.geometry && node.morphTargetDictionary && node.morphTargetInfluences) targets.push(node);
    });
    const names = new Map(Object.entries(sourceDictionary).map(([name, index]) => [index, name]));
    let sourceTracks = 0, boundTracks = 0;
    const boundMeshes = new Set();
    clip.tracks = clip.tracks.flatMap(track => {
        const match = /^\.morphTargetInfluences\[(\d+)\]$/.exec(track.name);
        if (!match) return [track];
        sourceTracks++;
        const name = names.get(Number(match[1]));
        return targets.flatMap(mesh => {
            const index = mesh.morphTargetDictionary[name];
            if (!Number.isInteger(index) || index < 0 || index >= mesh.morphTargetInfluences.length) return [];
            const copy = track.clone();
            copy.name = `${mesh.uuid}.morphTargetInfluences[${index}]`;
            boundTracks++;
            boundMeshes.add(mesh.uuid);
            return [copy];
        });
    });
    return { sourceTracks, boundTracks, boundMeshes: boundMeshes.size, availableMeshes: targets.length };
}
