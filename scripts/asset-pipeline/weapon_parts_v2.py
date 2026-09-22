"""Machined and moulded weapon parts in the held-item reference plane."""
import math
import bpy
from enemy_parts_b import plate, tube
from weapon_surface_parts import material as surface_material, paint_depth


class WeaponParts:
    def __init__(self, ctx, spec):
        self.c, self.objects = ctx, []
        self.gx, self.gy = spec['heldItem']['grip']
        mx, my = spec['heldItem']['muzzle']
        self.x, self.length = mx-self.gx, self.gy-my
        palette = spec['model']['palette']
        self.steel = self.material('Parkerized steel', tuple(palette['steel']), .35, kind='steel')
        self.edge = self.material('Satin machined metal', tuple(palette['edge']), .45, kind='edge')
        self.body = self.material('Coated receiver and composite shell', tuple(palette['body']), .12)
        self.trim = self.material('Colored service panels', tuple(palette['trim']), .16)
        self.heated = self.material('Heat-cycled protective metal', tuple(palette['trim']), .38, kind='heat')
        self.dark = self.material('Graphite rubber', (.015,.022,.028), kind='rubber')
        self.black = self.material('Deep mechanical recess', (.004,.008,.012), kind='recess')
        self.wood = self.material('Oiled walnut', tuple(palette.get('wood',(.30,.105,.032))), wood=True)
        self.olive = self.material('Olive composite', tuple(palette.get('olive',(.17,.225,.085))), kind='composite')
        self.brass = self.material('Aged brass and copper', tuple(palette.get('brass',(.42,.235,.075))), .4, kind='brass')
        self.accent = self.material('Painted identity panels', tuple(spec['model']['accent']), .1)
        self.energy = self.material('Contained ceramic conductor', tuple(spec['model']['accent']), .1, kind='ceramic')
        self.energy.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value = .12

    def material(self, name, color, metal=0, wood=False, kind='coat'):
        return surface_material(self.c, name, color, metal, 'wood' if wood else kind)

    def p(self,x,t,z): return (self.gx+x-16,16-self.gy+t,z)
    def add(self,ob):
        paint_depth(self.c, ob)
        self.objects.append(ob)
        return ob

    def box(self,name,x,t,w,length,mat=None,z=2,h=1,bevel=.16):
        return self.add(self.c.box(name,self.p(x,t,z),(w,length,h),mat or self.steel,bevel))

    def plate(self,name,points,mat=None,z=2,h=1,bevel=.15):
        return self.add(plate(self.c,name,self.p(0,0,z),points,h,mat or self.steel,bevel))

    def ell(self,name,x,t,w,length,mat=None,z=2,h=1):
        return self.add(self.c.ell(name,self.p(x,t,z),(w/2,length/2,h/2),mat or self.steel))

    def path(self,name,points,radius,mat=None):
        return self.add(tube(self.c,name,[self.p(*p) for p in points],radius,mat or self.dark,12))

    def round_body(self,name,x,sections,mat=None,z=2,height=1):
        """Loft actual convex sections with authored shoulder widths."""
        vertices=[]; count=24
        for t,width in sections:
            for i in range(count):
                a=math.tau*i/count
                vertices.append(self.p(x+width*.5*math.cos(a),t,z+height*.5*math.sin(a)))
        faces=[tuple(range(count)),tuple((len(sections)-1)*count+i for i in reversed(range(count)))]
        for j in range(len(sections)-1):
            for i in range(count):
                a=j*count+i; b=j*count+(i+1)%count; faces.append((a,a+count,b+count,b))
        mesh=bpy.data.meshes.new(name); mesh.from_pydata(vertices,[],faces); mesh.update()
        mesh.materials.append(mat or self.steel)
        ob=bpy.data.objects.new(name,mesh); self.c.scene.collection.objects.link(ob)
        for face in mesh.polygons: face.use_smooth=len(face.vertices)==4
        return self.add(ob)

    def barrel(self,name,x,start,end,radius,mat=None,z=2.3,front=None,hollow=False):
        front=radius if front is None else front
        rings=[(start,radius),(end,front)]
        if hollow: rings += [(end,front*.72),(end-min(.7,abs(end-start)*.8),front*.72)]
        ob=self.round_body(name,x,[(t,r*2) for t,r in rings],mat,z,height=radius*2)
        for j,(_,r) in enumerate(rings):
            for i in range(24): ob.data.vertices[j*24+i].co.z=z+r*math.sin(math.tau*i/24)
        if hollow:
            ob.data.materials.append(self.black)
            for face in list(ob.data.polygons)[2+2*24:]: face.material_index=1
        return ob

    def disk(self,name,x,t,r,mat=None,z=3,h=.15):
        return self.add(self.c.cylinder(name,self.p(x,t,z),r,h,mat or self.edge,48))

    def screw(self,x,t,z=3,r=.16):
        self.disk('Recessed fastener seat',x,t,r*1.4,self.black,z,.055)
        self.disk('Steel screw head',x,t,r,self.edge,z+.04,.07)
        self.box('Screw driver slot',x,t,r*1.25,.055,self.black,z+.083,.025,.01)

    def rail(self,x,t,length,z=3,width=1.1):
        self.box('Sight rail spine',x,t,width*.72,length,self.dark,z,.35,.07)
        for i in range(max(2,round(length/.55))):
            self.box('Picatinny cross tooth',x,t-length/2+.27+i*.55,width,.27,self.edge,z+.2,.14,.035)

    def vent(self,x,t,width=.9,z=3):
        self.box('Inset cooling port',x,t,width,.30,self.black,z,.09,.09)
        self.box('Port lower lip',x,t-.17,width*.8,.07,self.edge,z+.01,.04,.025)

    def grip(self):
        self.round_body('Moulded pistol grip',0,[(-1.5,1.7),(-1.1,2.25),(1,2.15),(2.2,1.55)],self.dark,z=.65,height=2)
        # Trigger and guard sit below the receiver in its longitudinal plane.
        # They are retained for side views, not splayed sideways for top visibility.
        self.path('Open trigger guard',[(self.x,.5,.7),(self.x,1,-.25),(self.x,3.6,-.25),(self.x,4.1,.7)],.22,self.steel)
        self.path('Curved trigger',[(self.x,2.8,.8),(self.x,2.5,.1),(self.x,1.9,.0)],.13,self.edge)

    def scope(self,x,t,length=7,z=3.55):
        self.barrel('Scope main tube',x,t-length*.4,t+length*.4,.40,self.dark,z)
        self.barrel('Objective bell',x,t+length*.22,t+length*.58,.42,self.steel,z,front=.72)
        self.barrel('Ocular housing',x,t-length*.52,t-length*.24,.62,self.dark,z)
        for at in (t-length*.2,t+length*.16):
            self.box('Scope mount foot',x,at,1.8,.65,self.steel,z-.7,.45,.08)
            self.barrel('Split scope mounting ring',x,at-.20,at+.20,.55,self.edge,z)
            self.screw(x+.65,at,z-.37,.12)
        self.disk('Elevation turret',x,t,.42,self.dark,z+.50,.45)
        self.disk('Adjustment dial',x,t,.33,self.edge,z+.75,.10)
        self.box('Dial index',x,t,.07,.42,self.dark,z+.82,.025,.01)
        self.ell('Windage knob',x+.58,t,.6,.6,self.steel,z,.65)
        self.barrel('Objective lens recess',x,t+length*.56,t+length*.60,.59,self.black,z)

    def tank(self,name,x,start,end,r,mat=None,z=2.1):
        self.barrel(name,x,start+r*.4,end-r*.4,r,mat or self.accent,z)
        for t in (start+r*.4,end-r*.4): self.ell('Rounded pressure vessel end',x,t,2*r,r,mat or self.accent,z,2*r)
        for t in (start+(end-start)*.23,start+(end-start)*.77): self.barrel('Tank retaining strap',x,t-.18,t+.18,r+.10,self.steel,z)
        self.barrel('Valve neck',x,end-r*.15,end+.38,r*.35,self.brass,z)

    def gauge(self,x,t,z=3.3,r=.48):
        self.disk('Instrument bezel',x,t,r,self.edge,z,.22)
        self.disk('Recessed gauge face',x,t,r*.76,self.olive,z+.13,.05)
        self.path('Gauge needle',[(x-.15,t-.15,z+.18),(x+.17,t+.20,z+.18)],.045,self.black)
