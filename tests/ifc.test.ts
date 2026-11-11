import { describe, expect, it } from "vitest";
import { ifcToPlan } from "../src/plan/ifc";
import { importPlan } from "../src/plan/import";

// A hand-written IFC2x3 file in millimetres: a 6 × 4 m box of four walls on one
// storey, one of them placed with a quarter turn, a door and a window.
const wall = (n: number, placement: string, len: number) => `
#${n}=IFCWALLSTANDARDCASE('g${n}',$,'Wall ${n}',$,$,#${n + 1},#${n + 5},$);
#${n + 1}=IFCLOCALPLACEMENT(#20,#${n + 2});
#${n + 2}=IFCAXIS2PLACEMENT3D(${placement});
#${n + 5}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${n + 6},#${n + 8}));
#${n + 6}=IFCSHAPEREPRESENTATION(#5,'Axis','Curve2D',(#${n + 7}));
#${n + 7}=IFCPOLYLINE((#30,#${n + 9}));
#${n + 9}=IFCCARTESIANPOINT((${len}.,0.));
#${n + 8}=IFCSHAPEREPRESENTATION(#5,'Body','SweptSolid',(#${n + 10}));
#${n + 10}=IFCEXTRUDEDAREASOLID(#${n + 11},#31,#32,2700.);
#${n + 11}=IFCRECTANGLEPROFILEDEF(.AREA.,$,#${n + 12},${len}.,300.);
#${n + 12}=IFCAXIS2PLACEMENT2D(#${n + 13},$);
#${n + 13}=IFCCARTESIANPOINT((${len / 2}.,0.));`;
const IFC = `ISO-10303-21;
HEADER;FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');FILE_NAME('box.ifc','2026-11-11',('a;b'),(''),'','','');FILE_SCHEMA(('IFC2X3'));ENDSEC;
DATA;
#1=IFCPROJECT('gp',$,'Box house',$,$,$,$,(#5),#2);
#2=IFCUNITASSIGNMENT((#3));
#3=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#5=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#31,$);
#10=IFCBUILDINGSTOREY('gs',$,'Erdgeschoss',$,$,#20,$,$,.ELEMENT.,0.);
#20=IFCLOCALPLACEMENT($,#21);
#21=IFCAXIS2PLACEMENT3D(#22,$,$);
#22=IFCCARTESIANPOINT((10000.,5000.,0.));
#30=IFCCARTESIANPOINT((0.,0.));
#31=IFCAXIS2PLACEMENT3D(#33,$,$);
#32=IFCDIRECTION((0.,0.,1.));
#33=IFCCARTESIANPOINT((0.,0.,0.));
#40=IFCCARTESIANPOINT((0.,0.,0.));
#41=IFCCARTESIANPOINT((6000.,0.,0.));
#42=IFCCARTESIANPOINT((6000.,4000.,0.));
#43=IFCCARTESIANPOINT((0.,4000.,0.));
#44=IFCDIRECTION((0.,1.,0.));
#45=IFCDIRECTION((-1.,0.,0.));
#46=IFCDIRECTION((0.,-1.,0.));
#47=IFCDIRECTION((0.,0.,1.));
${wall(100, "#40,$,$", 6000)}
${wall(200, "#41,#47,#44", 4000)}
${wall(300, "#42,#47,#45", 6000)}
${wall(400, "#43,#47,#46", 4000)}
#500=IFCRELCONTAINEDINSPATIALSTRUCTURE('gr',$,$,$,(#100,#200,#300,#400,#600,#700),#10);
#510=IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$);
#511=IFCPROPERTYSET('gps',$,'Pset_WallCommon',$,(#510));
#512=IFCRELDEFINESBYPROPERTIES('grp',$,$,$,(#100,#200,#300,#400),#511);
#600=IFCDOOR('gd',$,'Haust\\X\\FCr; vorne',$,$,#601,$,$,2100.,1000.);
#601=IFCLOCALPLACEMENT(#101,#602);
#602=IFCAXIS2PLACEMENT3D(#603,$,$);
#603=IFCCARTESIANPOINT((1500.,0.,0.));
#610=IFCOPENINGELEMENT('go',$,'Opening',$,$,#601,$,$);
#611=IFCRELVOIDSELEMENT('gv',$,$,$,#100,#610);
#612=IFCRELFILLSELEMENT('gf',$,$,$,#610,#600);
#700=IFCWINDOW('gw',$,'Fenster',$,$,#701,$,$,1200.,1600.);
#701=IFCLOCALPLACEMENT(#201,#702);
#702=IFCAXIS2PLACEMENT3D(#703,$,$);
#703=IFCCARTESIANPOINT((1000.,0.,900.));
ENDSEC;
END-ISO-10303-21;`;

describe("IFC subset", () => {
  it("turns walls, a door, a window and the storey into a plan", () => {
    const r = ifcToPlan(IFC);
    if ("errors" in r) throw new Error(r.errors.join("\n"));
    const level = (r.plan.levels as { name: string; height: number; walls: { id: string; from: number[]; to: number[]; thickness: number; exterior: boolean }[]; openings: Record<string, unknown>[] }[])[0]!;
    expect(r.plan.name).toBe("Box house");
    expect(level.name).toBe("Erdgeschoss");
    expect(level.height).toBeCloseTo(2.7);
    expect(level.walls).toHaveLength(4);
    // Millimetres became metres; the storey's own placement (10 m, 5 m) is applied.
    expect(level.walls[0]).toMatchObject({ from: [10, 5], to: [16, 5], thickness: 0.3, exterior: true });
    // The second wall is turned a quarter: it runs north from the first one's end.
    expect(level.walls[1]).toMatchObject({ from: [16, 5], to: [16, 9] });
    expect(level.walls[2]).toMatchObject({ from: [16, 9], to: [10, 9] });
    // Door through its opening; window found by the nearest wall. The ";" inside the door's name is no statement end.
    expect(level.openings[0]).toMatchObject({ type: "door", wall: "wall-100", offset: 1.5, width: 1, height: 2.1, sill: 0 });
    expect(level.openings[1]).toMatchObject({ type: "window", wall: "wall-200", offset: 1, width: 1.6, height: 1.2, sill: 0.9 });
    expect(r.warnings[0]).toMatch(/experimental/);

    // …and the plan passes the same checks as a JSON file.
    const p = importPlan(r.plan);
    if (!p.ok) throw new Error(p.errors.join("\n"));
    expect(p.house.walls[0]!.a).toEqual({ x: 0, z: 0 });
    expect(p.house.walls.every((w) => w.exterior)).toBe(true);
    expect(p.house.openings).toHaveLength(2);
    expect(p.house.rooms).toHaveLength(1); // no rooms in the subset: one room for the whole floor
    expect(p.house.storeyHeight).toBeCloseTo(2.7);
  });

  it("refuses what it cannot read", () => {
    expect(ifcToPlan("hello")).toEqual({ errors: ["This is not an IFC file (it does not start with ISO-10303-21)."] });
    const none = ifcToPlan("ISO-10303-21;\nDATA;\n#1=IFCPROJECT('g',$,'Empty',$,$,$,$,$,$);\nENDSEC;\nEND-ISO-10303-21;");
    expect("errors" in none && none.errors[0]).toMatch(/No wall with a readable axis/);
  });
});
